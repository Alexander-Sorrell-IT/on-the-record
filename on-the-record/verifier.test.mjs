// Test for the offline receipt-chain verifier.
// Builds a synthetic 3-row valid chain (computing hashes the SAME way as the
// verifier), runs the verifier -> expects CHAIN OK, then flips one byte in
// row 1 and re-runs -> expects BROKEN AT the right seq.
//
// Pure Node ESM. ZERO SDK. ZERO network.

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeHash, chainHead } from './verifier.mjs';

const VERIFIER = fileURLToPath(new URL('./verifier.mjs', import.meta.url));
const GENESIS_PREV = '0'.repeat(64);
const SALT = 'a1b2c3d4e5f6071829'.padEnd(64, '0'); // public per-tenant constant (hex)

// Build a valid 3-row chain by computing each hash the same way the verifier does.
function buildChain() {
  const base = [
    { seq: 0, ts: '2026-06-13T00:00:00Z', caller_did: 'did:ex:alice', action: 'read',  outcome: 'allowed', masked_secret: 'sk_****1111' },
    { seq: 1, ts: '2026-06-13T00:01:00Z', caller_did: 'did:ex:bob',   action: 'write', outcome: 'denied',  masked_secret: 'sk_****2222' },
    { seq: 2, ts: '2026-06-13T00:02:00Z', caller_did: 'did:ex:carol', action: 'read',  outcome: 'allowed', masked_secret: 'sk_****3333' },
  ];

  const rows = [];
  let prevHash = GENESIS_PREV;
  for (const r of base) {
    const row = { ...r, prev_hash: prevHash };
    row.hash = computeHash(SALT, prevHash, row);
    rows.push(row);
    prevHash = row.hash;
  }
  return { salt: SALT, rows };
}

function runVerifier(exportObj) {
  const dir = mkdtempSync(join(tmpdir(), 'otr-verify-'));
  const file = join(dir, 'export.json');
  writeFileSync(file, JSON.stringify(exportObj));
  let out;
  let code = 0;
  try {
    out = execFileSync('node', [VERIFIER, file], { encoding: 'utf8' });
  } catch (e) {
    // non-zero exit (BROKEN) still carries stdout
    out = e.stdout != null ? e.stdout : '';
    code = e.status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { out: out.trim(), code };
}

// Run the verifier in --cross mode over two export objects.
function runCross(exportA, exportB) {
  const dir = mkdtempSync(join(tmpdir(), 'otr-cross-'));
  const fa = join(dir, 'a.json');
  const fb = join(dir, 'b.json');
  writeFileSync(fa, JSON.stringify(exportA));
  writeFileSync(fb, JSON.stringify(exportB));
  let out;
  let code = 0;
  try {
    out = execFileSync('node', [VERIFIER, '--cross', fa, fb], { encoding: 'utf8' });
  } catch (e) {
    out = e.stdout != null ? e.stdout : '';
    code = e.status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { out: out.trim(), code };
}

// Build a chain row-by-row from a list of partial rows (no prev_hash/hash),
// computing each hash the way the verifier does. Returns the export object.
function buildExport(tidHex, partials) {
  const saltString = `on-the-record:v1:${tidHex}`;
  const salt = Buffer.from(saltString, 'utf8').toString('hex');
  const rows = [];
  let prevHash = GENESIS_PREV;
  for (const p of partials) {
    const row = { ...p, prev_hash: prevHash };
    row.hash = computeHash(salt, prevHash, row);
    rows.push(row);
    prevHash = row.hash;
  }
  return { salt, salt_string: saltString, rows, did: `did:t3n:${tidHex}` };
}

function sealRow(seq, tidHex, peerDid, peerHead) {
  return {
    seq, ts: 1781371000 + seq, caller_did: `did:t3n:${tidHex}`,
    action: JSON.stringify({ type: 'seal', peer_did: peerDid, peer_head: peerHead }),
    outcome: 'allowed', masked_secret: '', reason: '',
  };
}

// Mirror the real cross-anchor ordering with synthetic chains:
//   A3 builds an init row (pre-seal head h3).
//   A2 builds init + seal(A3, h3); A2's final head is h2.
//   A3 appends seal(A2, h2); A3's final head changes but A2 already anchored h3.
// Result: A2 anchors A3's pre-seal head; A3 anchors A2's final head.
function buildCrossPair() {
  const A2_TID = 'a2'.repeat(20);
  const A3_TID = 'a3'.repeat(20);
  const a2Did = `did:t3n:${A2_TID}`;
  const a3Did = `did:t3n:${A3_TID}`;

  // A3 pre-seal chain (just init).
  const a3Pre = buildExport(A3_TID, [
    { seq: 0, ts: 1781371000, caller_did: a3Did, action: 'init', outcome: 'allowed', masked_secret: 'sk_l…****…3333', reason: '' },
  ]);
  const h3 = chainHead(a3Pre);

  // A2 chain: init + seal(A3, h3). A2's head is now h2.
  const a2 = buildExport(A2_TID, [
    { seq: 0, ts: 1781371000, caller_did: a2Did, action: 'init', outcome: 'allowed', masked_secret: 'sk_l…****…2222', reason: '' },
    sealRow(1, A2_TID, a3Did, h3),
  ]);
  const h2 = chainHead(a2);

  // A3 final chain: init + seal(A2, h2).
  const a3 = buildExport(A3_TID, [
    { seq: 0, ts: 1781371000, caller_did: a3Did, action: 'init', outcome: 'allowed', masked_secret: 'sk_l…****…3333', reason: '' },
    sealRow(1, A3_TID, a2Did, h2),
  ]);

  return { a2, a3, h2, h3, a2Did, a3Did };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
  }
}

// --- Test 1: valid chain -> CHAIN OK 3 rows ---
const valid = buildChain();
const r1 = runVerifier(valid);
check('valid chain prints CHAIN OK 3 rows', r1.out === 'CHAIN OK 3 rows', `got: "${r1.out}" (exit ${r1.code})`);

// --- Test 2: flip one byte in row 1 -> BROKEN AT seq=1 ---
// Tamper with the stored data of row 1 (its masked_secret) WITHOUT recomputing
// its hash. The recomputed hash for seq=1 will no longer match -> first break at seq=1.
const tampered = buildChain();
const ms = tampered.rows[1].masked_secret;
// flip one byte: change the last char deterministically
const flipped = ms.slice(0, -1) + (ms.slice(-1) === '2' ? '9' : '2');
tampered.rows[1].masked_secret = flipped;
check('byte was actually flipped', tampered.rows[1].masked_secret !== ms);

const r2 = runVerifier(tampered);
check('tampered chain prints BROKEN AT seq=1', r2.out === 'BROKEN AT seq=1', `got: "${r2.out}" (exit ${r2.code})`);

// --- Test 3: cross-anchor positive -> CROSS-ANCHOR OK ---
const { a2, a3 } = buildCrossPair();
const r3 = runCross(a2, a3);
check('cross-anchor positive prints CROSS-ANCHOR OK', r3.out.startsWith('CROSS-ANCHOR OK'), `got: "${r3.out}" (exit ${r3.code})`);
check('cross-anchor positive exits 0', r3.code === 0, `exit ${r3.code}`);

// --- Test 4 (NEGATIVE): forge A2's head row -> cross-anchor FAILS ---
// Hand-edit A2's final (seal) row's hash. This both breaks A2's own chain AND
// changes A2's head, so A3's anchor of the old head no longer matches.
{
  const { a2: a2bad, a3: a3good } = buildCrossPair();
  const last = a2bad.rows[a2bad.rows.length - 1];
  // flip last hex nibble of the head hash (forged head).
  const ch = last.hash.slice(-1);
  last.hash = last.hash.slice(0, -1) + (ch === 'f' ? '0' : 'f');
  const r4 = runCross(a2bad, a3good);
  check('forged head -> CROSS-ANCHOR MISMATCH', r4.out.startsWith('CROSS-ANCHOR MISMATCH'), `got: "${r4.out}" (exit ${r4.code})`);
  check('forged head -> nonzero exit', r4.code === 1, `exit ${r4.code}`);
}

// --- Test 5 (NEGATIVE): rewrite A3's body so its head no longer matches A2's seal ---
// Edit A3's init action and recompute A3's chain so it stays internally valid
// (CHAIN OK) but its head differs from the head A2 sealed -> anchor mismatch.
{
  const A3_TID = 'a3'.repeat(20);
  const A2_TID = 'a2'.repeat(20);
  const a2Did = `did:t3n:${A2_TID}`;
  const a3Did = `did:t3n:${A3_TID}`;
  const { a2: a2good } = buildCrossPair();
  // A3 with a DIFFERENT init action -> different pre-seal head than A2 sealed.
  const a3Forged = buildExport(A3_TID, [
    { seq: 0, ts: 1781371000, caller_did: a3Did, action: 'FORGED-init', outcome: 'allowed', masked_secret: 'sk_l…****…3333', reason: '' },
    sealRow(1, A3_TID, a2Did, chainHead(a2good)),
  ]);
  const r5 = runCross(a2good, a3Forged);
  // a2good still anchors the ORIGINAL a3 pre-seal head, which a3Forged no longer has.
  check('forged A3 body -> CROSS-ANCHOR MISMATCH (head not anchored)', r5.out.startsWith('CROSS-ANCHOR MISMATCH'), `got: "${r5.out}" (exit ${r5.code})`);
}

if (failures === 0) {
  console.log('ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`${failures} TEST(S) FAILED`);
  process.exit(1);
}
