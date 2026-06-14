// Standalone OFFLINE verifier for the "On the Record" receipt chain.
// Pure Node ESM. ZERO SDK. ZERO network. Built-in crypto only.
//
// Reads an export JSON file:
//   { salt: <utf8 string>, rows: [ {seq, ts, caller_did, action, outcome, masked_secret, reason, prev_hash, hash}, ... ] }
//
// HASH RULE:
//   hash = hex( SHA256( utf8(salt) || prev_hash_bytes(hexdecoded) || canonical_json(record WITHOUT hash) ) )
//   - canonical_json = deterministic, sorted-keys serialization.
//   - prev_hash for genesis (row 0) = 64 hex zeros.
//   - salt is a PUBLIC per-tenant domain-separation string (not secret), shipped
//     verbatim in the export. The contract hashes its ASCII bytes; we match with
//     Buffer.from(salt, 'utf8') — no hex round-trip.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const GENESIS_PREV = '0'.repeat(64);

// Deterministic, sorted-keys JSON serialization.
// Recurses into nested objects so key order never affects the hash.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]));
  return '{' + parts.join(',') + '}';
}

// Recompute the hash for a single row given its prev_hash.
export function computeHash(salt, prevHashHex, row) {
  const { hash, ...recordWithoutHash } = row; // strip hash field
  const h = createHash('sha256');
  h.update(Buffer.from(salt, 'utf8'));
  h.update(Buffer.from(prevHashHex, 'hex'));
  h.update(Buffer.from(canonicalJson(recordWithoutHash), 'utf8'));
  return h.digest('hex');
}

// Verify a chain. Returns { ok: true, n } or { ok: false, brokenSeq }.
export function verifyChain(exportObj) {
  const salt = exportObj.salt;
  const rows = [...exportObj.rows].sort((a, b) => a.seq - b.seq);

  let prevHash = GENESIS_PREV;
  for (const row of rows) {
    // prev_hash must link to the prior row's hash (genesis = 64 zeros).
    if (row.prev_hash !== prevHash) {
      return { ok: false, brokenSeq: row.seq };
    }
    const expected = computeHash(salt, row.prev_hash, row);
    if (expected !== row.hash) {
      return { ok: false, brokenSeq: row.seq };
    }
    prevHash = row.hash;
  }
  return { ok: true, n: rows.length };
}

// Return the chain head (the hash of the max-seq row), or 64 zeros if empty.
export function chainHead(exportObj) {
  const rows = [...exportObj.rows].sort((a, b) => a.seq - b.seq);
  return rows.length === 0 ? GENESIS_PREV : rows[rows.length - 1].hash;
}

// Parse a row's action into a seal descriptor, or null if it isn't a seal.
// A seal row's `action` is the canonical JSON string
// {"type":"seal","peer_did":...,"peer_head":...} and its outcome is "allowed".
export function parseSeal(row) {
  if (row.outcome !== 'allowed') return null;
  let a;
  try { a = JSON.parse(row.action); } catch { return null; }
  if (a && a.type === 'seal' && typeof a.peer_did === 'string' && typeof a.peer_head === 'string') {
    return { peer_did: a.peer_did, peer_head: a.peer_head, row };
  }
  return null;
}

// The newest "allowed" seal row in `exportObj` that anchors `peerDid`, or null.
export function findSealByPeer(exportObj, peerDid) {
  const seals = [...exportObj.rows]
    .sort((a, b) => a.seq - b.seq)
    .map(parseSeal)
    .filter((s) => s && s.peer_did === peerDid);
  return seals.length ? seals[seals.length - 1] : null;
}

// Find a "seal" receipt anchoring a specific (peerDid, peerHead) pair.
export function findSealForHead(exportObj, peerDid, peerHead) {
  for (const row of exportObj.rows) {
    const s = parseSeal(row);
    if (s && s.peer_did === peerDid && s.peer_head === peerHead) return row;
  }
  return null;
}

// Extract this tenant's own DID from its public salt ("on-the-record:v1:<tidhex>").
export function tenantDidFromSalt(exportObj) {
  const m = /:v1:([0-9a-f]+)$/.exec(exportObj.salt_string || exportObj.salt || '');
  return m ? `did:t3n:${m[1]}` : null;
}

// The head the OTHER tenant legitimately observed when it sealed this chain.
// Because the two seals are ordered (one tenant seals first, then the second
// seals — including the first's seal row), the head a peer sealed is EITHER:
//   - this chain's final head (it sealed us LAST, after our own seal row), OR
//   - the prev_hash of OUR seal-back row to that peer (it sealed us FIRST, so
//     it observed our head right before we appended our seal-to-it row).
// Both are genuine hashes physically present in this chain, so a forged head
// (one that is neither) is rejected. peerDid is the tenant that sealed us.
export function sealableHeads(exportObj, peerDid) {
  const heads = new Set([chainHead(exportObj)]);
  const back = findSealByPeer(exportObj, peerDid);
  if (back && /^[0-9a-f]{64}$/.test(back.row.prev_hash)) heads.add(back.row.prev_hash);
  return heads;
}

// CROSS-ANCHOR check. Asserts:
//   (i)   each chain individually verifies CHAIN OK,
//   (ii)  A's chain contains a seal row anchoring B, and the anchored peer_head
//         is a head B legitimately exposed (B's final head, or B's head right
//         before B sealed A back),
//   (iii) symmetrically, B's chain anchors A's exposed head.
// To forge either chain you must also forge the peer's chain (whose head is
// anchored inside yours) — no single tenant can rewrite history alone.
// Returns { ok, reason?, aHead, bHead, aDid, bDid, aSealed, bSealed }.
export function verifyCrossAnchor(exportA, exportB) {
  const ca = verifyChain(exportA);
  if (!ca.ok) return { ok: false, reason: `chain A BROKEN AT seq=${ca.brokenSeq}` };
  const cb = verifyChain(exportB);
  if (!cb.ok) return { ok: false, reason: `chain B BROKEN AT seq=${cb.brokenSeq}` };

  const aHead = chainHead(exportA);
  const bHead = chainHead(exportB);
  const aDid = tenantDidFromSalt(exportA);
  const bDid = tenantDidFromSalt(exportB);

  // (ii) A anchors B: A has a seal row naming B whose peer_head is a head B
  // legitimately exposed (B's final head OR B's pre-seal-back head).
  const sealInA = findSealByPeer(exportA, bDid);
  if (!sealInA) {
    return { ok: false, reason: `A has no seal anchoring B (${bDid})`, aHead, bHead, aDid, bDid };
  }
  const bExposed = sealableHeads(exportB, aDid);
  if (!bExposed.has(sealInA.peer_head)) {
    return { ok: false, reason: `A anchors a forged B head: peer_head=${sealInA.peer_head} is not a real B head (B head=${bHead})`, aHead, bHead, aDid, bDid, aSealed: sealInA.peer_head };
  }

  // (iii) B anchors A symmetrically.
  const sealInB = findSealByPeer(exportB, aDid);
  if (!sealInB) {
    return { ok: false, reason: `B has no seal anchoring A (${aDid})`, aHead, bHead, aDid, bDid };
  }
  const aExposed = sealableHeads(exportA, bDid);
  if (!aExposed.has(sealInB.peer_head)) {
    return { ok: false, reason: `B anchors a forged A head: peer_head=${sealInB.peer_head} is not a real A head (A head=${aHead})`, aHead, bHead, aDid, bDid, bSealed: sealInB.peer_head };
  }

  return { ok: true, aHead, bHead, aDid, bDid, aSealed: sealInA.peer_head, bSealed: sealInB.peer_head };
}

// CLI entrypoint:
//   node verifier.mjs <export.json>                       # single-chain check
//   node verifier.mjs --cross <export-a.json> <export-b.json>  # cross-anchor check
function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--cross') {
    const [, pa, pb] = argv;
    if (!pa || !pb) {
      console.error('usage: node verifier.mjs --cross <export-a.json> <export-b.json>');
      process.exit(2);
    }
    const a = JSON.parse(readFileSync(pa, 'utf8'));
    const b = JSON.parse(readFileSync(pb, 'utf8'));
    const r = verifyCrossAnchor(a, b);
    if (r.ok) {
      console.log(`CROSS-ANCHOR OK (A head=${r.aHead} sealed in B; B head=${r.bHead} sealed in A)`);
      process.exit(0);
    } else {
      console.log(`CROSS-ANCHOR MISMATCH: ${r.reason}`);
      process.exit(1);
    }
  }

  const path = argv[0];
  if (!path) {
    console.error('usage: node verifier.mjs <export.json> | --cross <a.json> <b.json>');
    process.exit(2);
  }
  const exportObj = JSON.parse(readFileSync(path, 'utf8'));
  const result = verifyChain(exportObj);
  if (result.ok) {
    console.log(`CHAIN OK ${result.n} rows`);
    process.exit(0);
  } else {
    console.log(`BROKEN AT seq=${result.brokenSeq}`);
    process.exit(1);
  }
}

// Run main() only when invoked directly, not when imported by the test.
// Use pathToFileURL so paths with spaces / special chars compare correctly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
