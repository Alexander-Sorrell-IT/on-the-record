// Test for the offline receipt-chain verifier.
//
// Part A — single chain: builds a synthetic 3-row valid chain (computing hashes
// the SAME way as the verifier), runs the verifier -> expects CHAIN OK, then
// flips one byte and re-runs -> expects BROKEN AT the right seq.
//
// Part B — PROVABLY SOUND cross-anchor (3 states OK / WEAK / MISMATCH). All
// states are exercised. The REAL shipped testnet exports now cross-anchor OK
// (both tenants seal each other's real heads). Every other fixture is SYNTHETIC,
// constructed locally with clearly-fake tenant IDs (NOT testnet captures): a
// synthetic genesis-only pair (WEAK), proper two-row binding (OK), a fabricated
// peer head (MISMATCH), a shadow attack (MISMATCH), and a post-anchor rewrite of
// the peer (MISMATCH).
//
// Pure Node ESM. ZERO SDK. ZERO network. ZERO testnet.

import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeHash, chainHead, verifyAuthority, parseAuthority } from './verifier.mjs';

const VERIFIER = fileURLToPath(new URL('./verifier.mjs', import.meta.url));
const HERE = dirname(fileURLToPath(import.meta.url));
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

// Run the verifier in --authority mode (zero-dep mandate-logic check) over an export.
function runAuthority(exportObj) {
  const dir = mkdtempSync(join(tmpdir(), 'otr-auth-'));
  const file = join(dir, 'export.json');
  writeFileSync(file, JSON.stringify(exportObj));
  let out;
  let code = 0;
  try {
    out = execFileSync('node', [VERIFIER, '--authority', file], { encoding: 'utf8' });
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

function actRow(seq, tidHex, action, secret) {
  return {
    seq, ts: 1781371000 + seq, caller_did: `did:t3n:${tidHex}`,
    action, outcome: 'allowed', masked_secret: secret, reason: '',
  };
}

function sealRow(seq, tidHex, peerDid, peerHead) {
  return {
    seq, ts: 1781371000 + seq, caller_did: `did:t3n:${tidHex}`,
    action: JSON.stringify({ type: 'seal', peer_did: peerDid, peer_head: peerHead }),
    outcome: 'allowed', masked_secret: '', reason: '',
  };
}

// An AUTHORITY-mandate row. `action` carries the terse on-chain authority blob
// {t,fn,amt,cap,fns,c} the verifier's parseAuthority reads (NOT crypto — that
// lives in authority-verify.mjs; this is the zero-dep mandate-logic shape only).
function authorityRow(seq, tidHex, { fn, amt, cap, fns, outcome }) {
  return {
    seq, ts: 1781371000 + seq, caller_did: `did:t3n:${tidHex}`,
    action: JSON.stringify({ t: 'authority', fn, amt, cap, fns, c: '9d35c3a97303f063401eb048978b6a8d' }),
    outcome, masked_secret: outcome === 'allowed' ? 'sk_l…****…AUTH' : '', reason: outcome === 'denied' ? 'no_active_grant' : '',
  };
}

// Clearly-synthetic tenant IDs (repeated nibbles — obviously not real).
const A_TID = 'aa'.repeat(20);
const B_TID = 'bb'.repeat(20);
const aDid = `did:t3n:${A_TID}`;
const bDid = `did:t3n:${B_TID}`;

// Build a proper two-direction, NON-GENESIS cross-anchored pair (the OK case).
// Ordering mirrors the real protocol:
//   1. B publishes an init row (pre-seal head hB_pre, non-genesis).
//   2. A publishes init + seal(B, hB_pre). A's head is now hA, non-genesis.
//   3. B appends seal(A, hA). B's head moves, but A already bound hB_pre, which
//      STILL exists in B's final chain (B only appended; never rewrote row 0).
// Result: A binds B's row-0 hash (real, non-genesis); B binds A's head (real,
// non-genesis). Both directions OK.
function buildOkPair() {
  const bPre = buildExport(B_TID, [
    actRow(0, B_TID, 'init', 'sk_l…****…BBBB'),
  ]);
  const hBpre = chainHead(bPre); // B's row-0 hash, non-genesis

  const a = buildExport(A_TID, [
    actRow(0, A_TID, 'init', 'sk_l…****…AAAA'),
    sealRow(1, A_TID, bDid, hBpre),
  ]);
  const hA = chainHead(a); // A's head, non-genesis

  const b = buildExport(B_TID, [
    actRow(0, B_TID, 'init', 'sk_l…****…BBBB'),
    sealRow(1, B_TID, aDid, hA),
  ]);

  return { a, b, hA, hBpre };
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

// =========================================================================
// PART A — single-chain verifier (unchanged behaviour)
// =========================================================================

// --- Test 1: valid chain -> CHAIN OK 3 rows ---
const valid = buildChain();
const r1 = runVerifier(valid);
check('valid chain prints CHAIN OK 3 rows', r1.out === 'CHAIN OK 3 rows', `got: "${r1.out}" (exit ${r1.code})`);

// --- Test 2: flip one byte in row 1 -> BROKEN AT seq=1 ---
const tampered = buildChain();
const ms = tampered.rows[1].masked_secret;
const flipped = ms.slice(0, -1) + (ms.slice(-1) === '2' ? '9' : '2');
tampered.rows[1].masked_secret = flipped;
check('byte was actually flipped', tampered.rows[1].masked_secret !== ms);

const r2 = runVerifier(tampered);
check('tampered chain prints BROKEN AT seq=1', r2.out === 'BROKEN AT seq=1', `got: "${r2.out}" (exit ${r2.code})`);

// =========================================================================
// PART B — PROVABLY SOUND cross-anchor: OK / WEAK / MISMATCH
// =========================================================================

// --- Test 3 (OK): proper multi-row, both directions bind real NON-GENESIS heads ---
{
  const { a, b } = buildOkPair();
  const r = runCross(a, b);
  check('(a) two-row both-directions non-genesis -> CROSS-ANCHOR OK',
    r.out.startsWith('CROSS-ANCHOR OK'), `got: "${r.out}" (exit ${r.code})`);
  check('(a) OK exits 0', r.code === 0, `exit ${r.code}`);
}

// --- Test 4 (OK on REAL data): the shipped testnet exports cross-anchor OK ---
// Load the real shipped exports. A2 now seals A3's real head, and A3 seals A2's
// real head -> both directions bind -> CROSS-ANCHOR OK, exit 0. Neither tenant
// can rewrite its history without breaking the peer's anchor.
{
  const a2 = JSON.parse(readFileSync(join(HERE, 'export-a2.json'), 'utf8'));
  const a3 = JSON.parse(readFileSync(join(HERE, 'export-a3.json'), 'utf8'));
  const r = runCross(a2, a3);
  check('(b) shipped testnet pair -> CROSS-ANCHOR OK',
    r.out.startsWith('CROSS-ANCHOR OK'), `got: "${r.out}" (exit ${r.code})`);
  check('(b) OK names both bound heads',
    r.out.includes('bound in B') && r.out.includes('bound in A'), `got: "${r.out}"`);
  check('(b) OK exits 0', r.code === 0, `exit ${r.code}`);
}

// --- Test 4b (WEAK): a SYNTHETIC genesis-only pair binds nothing yet ---
// Both tenants seal the other only at GENESIS. Each chain verifies, no forgery,
// but no real binding exists -> CROSS-ANCHOR WEAK (honest no-binding-yet), exit 0.
// This retains explicit WEAK-state coverage now that the shipped pair is OK.
{
  const aGenesis = buildExport(A_TID, [sealRow(0, A_TID, bDid, GENESIS_PREV)]);
  const bGenesis = buildExport(B_TID, [sealRow(0, B_TID, aDid, GENESIS_PREV)]);
  const r = runCross(aGenesis, bGenesis);
  check('(b2) synthetic genesis-only pair -> CROSS-ANCHOR WEAK',
    r.out.startsWith('CROSS-ANCHOR WEAK'), `got: "${r.out}" (exit ${r.code})`);
  check('(b2) WEAK names the genesis-anchored direction',
    r.out.includes('genesis') && r.out.includes('no binding'), `got: "${r.out}"`);
  check('(b2) WEAK exits 0 (honest no-binding, not a failure)', r.code === 0, `exit ${r.code}`);
}

// --- Test 5 (MISMATCH): A seals a fabricated peer_head not present in B ---
// Start from the OK pair; replace A's seal-of-B head with a hash that simply
// does not exist anywhere in B's chain. Re-derive A's chain so A is internally
// CHAIN OK (the lie is self-consistent inside A). Cross-anchor must catch it.
{
  const { b } = buildOkPair();
  const FAKE_HEAD = 'd'.repeat(64); // non-genesis, not any row hash in B
  const aForged = buildExport(A_TID, [
    actRow(0, A_TID, 'init', 'sk_l…****…AAAA'),
    sealRow(1, A_TID, bDid, FAKE_HEAD),
  ]);
  // sanity: A alone still verifies (the fabrication is self-consistent)
  const aAlone = runVerifier(aForged);
  check('(c) fabricated-head A still verifies CHAIN OK in isolation',
    aAlone.out.startsWith('CHAIN OK'), `got: "${aAlone.out}"`);
  const r = runCross(aForged, b);
  check('(c) fabricated peer_head not in peer chain -> CROSS-ANCHOR MISMATCH',
    r.out.startsWith('CROSS-ANCHOR MISMATCH'), `got: "${r.out}" (exit ${r.code})`);
  check('(c) MISMATCH exits 1', r.code === 1, `exit ${r.code}`);
}

// --- Test 6 (SHADOW ATTACK): honest seal + later forged/weaker seal ---
// A holds an HONEST seal of B's real head, then APPENDS a second, later seal of
// B naming a fabricated head (the attacker hopes the newer seal "shadows" the
// honest one and weakens the binding). Because the verifier inspects ALL seals
// (not just the newest), the fabricated later head is a non-existent peer head
// -> MISMATCH. The honest binding is NOT silently weakened away.
{
  const { b, hBpre } = buildOkPair();
  const FAKE_HEAD = 'e'.repeat(64);
  const aShadow = buildExport(A_TID, [
    actRow(0, A_TID, 'init', 'sk_l…****…AAAA'),
    sealRow(1, A_TID, bDid, hBpre),     // honest seal of B's real head
    sealRow(2, A_TID, bDid, FAKE_HEAD), // later forged/weaker seal
  ]);
  const aAlone = runVerifier(aShadow);
  check('(d) shadow-attack A still verifies CHAIN OK in isolation',
    aAlone.out.startsWith('CHAIN OK'), `got: "${aAlone.out}"`);
  const r = runCross(aShadow, b);
  check('(d) shadow attack (later forged seal) -> CROSS-ANCHOR MISMATCH (honest binding not shadowed)',
    r.out.startsWith('CROSS-ANCHOR MISMATCH'), `got: "${r.out}" (exit ${r.code})`);
  check('(d) shadow MISMATCH exits 1', r.code === 1, `exit ${r.code}`);
}

// Companion to (d): a NEWER seal at genesis must NOT weaken an existing honest
// binding. The honest non-genesis seal still wins -> OK (binding unweakened).
{
  const { b, hBpre } = buildOkPair();
  const aGenesisShadow = buildExport(A_TID, [
    actRow(0, A_TID, 'init', 'sk_l…****…AAAA'),
    sealRow(1, A_TID, bDid, hBpre),         // honest seal of B's real head
    sealRow(2, A_TID, bDid, GENESIS_PREV),  // later genesis seal (binds nothing)
  ]);
  const r = runCross(aGenesisShadow, b);
  check('(d2) later genesis seal does NOT weaken the honest binding -> still OK',
    r.out.startsWith('CROSS-ANCHOR OK'), `got: "${r.out}" (exit ${r.code})`);
}

// --- Test 7 (POST-ANCHOR REWRITE): peer rewrites a row after being sealed ---
// A honestly sealed B's real head (hBpre = B's row-0 hash). B then REWRITES its
// row 0 and re-derives its own chain so B alone still verifies CHAIN OK — but
// B's row-0 hash is now different, so the head A sealed no longer exists in B.
// Cross-anchor must catch the post-anchor rewrite -> MISMATCH.
{
  const { a } = buildOkPair(); // A bound B's ORIGINAL row-0 hash
  const bRewritten = buildExport(B_TID, [
    actRow(0, B_TID, 'REWRITTEN-AFTER-SEAL', 'sk_l…****…BBBB'),
    sealRow(1, B_TID, aDid, chainHead(a)),
  ]);
  const bAlone = runVerifier(bRewritten);
  check('(e) post-rewrite B still verifies CHAIN OK in isolation (fooled itself)',
    bAlone.out.startsWith('CHAIN OK'), `got: "${bAlone.out}"`);
  const r = runCross(a, bRewritten);
  check('(e) post-anchor rewrite of peer -> CROSS-ANCHOR MISMATCH',
    r.out.startsWith('CROSS-ANCHOR MISMATCH'), `got: "${r.out}" (exit ${r.code})`);
  check('(e) post-rewrite MISMATCH exits 1', r.code === 1, `exit ${r.code}`);
}

// --- Test 8 (MISMATCH): a BROKEN peer chain cannot be anchored against ---
// If B's chain does not even verify in isolation, A's seal can only reference
// fiction -> MISMATCH.
{
  const { a, b } = buildOkPair();
  const bBroken = JSON.parse(JSON.stringify(b));
  bBroken.rows[0].masked_secret = 'sk_l…****…XXXX'; // tamper without re-hashing
  const bAlone = runVerifier(bBroken);
  check('(f) tampered B is BROKEN in isolation',
    bAlone.out.startsWith('BROKEN'), `got: "${bAlone.out}"`);
  const r = runCross(a, bBroken);
  check('(f) BROKEN peer chain -> CROSS-ANCHOR MISMATCH',
    r.out.startsWith('CROSS-ANCHOR MISMATCH'), `got: "${r.out}" (exit ${r.code})`);
  check('(f) BROKEN-peer MISMATCH exits 1', r.code === 1, `exit ${r.code}`);
}

// =========================================================================
// PART C — AUTHORITY / delegation mandate-logic (zero-dep; crypto is separate)
// =========================================================================
// The core verifier carries a ZERO-DEPENDENCY mandate-logic check:
//   in_mandate  <=>  fn IN functions[]  AND  amount_cents <= cap_cents
// and the HARD soundness invariant: an OUT-of-mandate action must NOT be
// recorded as `allowed`. (Cryptographic re-verification of the delegation
// credential — EIP-191 user sig + agent invocation sig + commitment — lives in
// the SEPARATE authority-verify.mjs, which uses the SDK's own offline crypto;
// that surface is exercised by its own run, not here.)

const FNS = ['compute-payroll', 'execute-disbursement'];

// --- Test 9 (in-mandate ALLOW is consistent): fn in set, amount <= cap ---
{
  const exp = buildExport(A_TID, [
    authorityRow(0, A_TID, { fn: 'execute-disbursement', amt: 420000, cap: 1500000, fns: FNS, outcome: 'allowed' }),
  ]);
  const va = verifyAuthority(exp);
  const row = va.rows.find((r) => r.seq === 0);
  check('(g) in-mandate act is IN-MANDATE + consistent',
    row && row.in_mandate === true && row.consistent === true, JSON.stringify(row));
  check('(g) in-mandate-only export -> verifyAuthority ok', va.ok === true, JSON.stringify(va.flagged));
  const r = runAuthority(exp);
  check('(g) --authority CLI: in-mandate ALLOWED -> AUTHORITY OK, exit 0',
    r.out.includes('IN-MANDATE') && r.out.includes('AUTHORITY OK') && r.code === 0, `got: "${r.out}" (exit ${r.code})`);
}

// --- Test 10 (out-of-mandate DENIED is consistent): amount > cap, refused ---
{
  const exp = buildExport(A_TID, [
    authorityRow(0, A_TID, { fn: 'execute-disbursement', amt: 2500000, cap: 1500000, fns: FNS, outcome: 'denied' }),
  ]);
  const va = verifyAuthority(exp);
  const row = va.rows.find((r) => r.seq === 0);
  check('(h) over-cap act is OUT-OF-MANDATE; DENIED keeps it consistent',
    row && row.in_mandate === false && row.outcome === 'denied' && row.consistent === true, JSON.stringify(row));
  check('(h) out-of-mandate-but-denied export -> verifyAuthority ok', va.ok === true, JSON.stringify(va.flagged));
}

// --- Test 11 (HARD soundness): out-of-mandate recorded as ALLOWED is flagged ---
// This is the invariant that matters: an action OUTSIDE the mandate must never
// be recorded allowed. If it is, the verifier must flag it and the CLI must fail.
{
  const exp = buildExport(A_TID, [
    authorityRow(0, A_TID, { fn: 'execute-disbursement', amt: 2500000, cap: 1500000, fns: FNS, outcome: 'allowed' }),
  ]);
  const va = verifyAuthority(exp);
  check('(i) out-of-mandate ALLOWED is flagged inconsistent (the escape is caught)',
    va.ok === false && va.flagged.length === 1 && va.flagged[0].seq === 0, JSON.stringify(va));
  const r = runAuthority(exp);
  check('(i) --authority CLI: out-of-mandate ALLOW -> AUTHORITY VIOLATION, exit 1',
    r.out.includes('AUTHORITY VIOLATION') && r.code === 1, `got: "${r.out}" (exit ${r.code})`);
}

// --- Test 12 (out-of-set fn): fn NOT in functions[] is out-of-mandate ---
{
  const exp = buildExport(A_TID, [
    authorityRow(0, A_TID, { fn: 'wire-to-self', amt: 1, cap: 1500000, fns: FNS, outcome: 'allowed' }),
  ]);
  const row = verifyAuthority(exp).rows.find((r) => r.seq === 0);
  check('(j) fn outside functions[] -> within_cap but NOT in_mandate (and flagged when allowed)',
    row && row.within_cap === true && row.in_functions === false && row.in_mandate === false && row.consistent === false,
    JSON.stringify(row));
}

// --- Test 13 (parseAuthority is narrow): non-authority rows are ignored ---
// parseAuthority must return null for ordinary act/seal rows and only match the
// terse {t:"authority",...} shape, so verifyAuthority never mislabels a plain act.
{
  check('(k) parseAuthority(plain act) === null',
    parseAuthority(actRow(0, A_TID, 'load-policy', 'sk_****')) === null);
  check('(k) parseAuthority(seal row) === null',
    parseAuthority(sealRow(0, A_TID, bDid, GENESIS_PREV)) === null);
  const exp = buildExport(A_TID, [
    actRow(0, A_TID, 'load-policy', 'sk_****'),
    authorityRow(1, A_TID, { fn: 'execute-disbursement', amt: 420000, cap: 1500000, fns: FNS, outcome: 'allowed' }),
  ]);
  check('(k) verifyAuthority counts only the authority row, ignoring the plain act',
    verifyAuthority(exp).rows.length === 1, JSON.stringify(verifyAuthority(exp).rows));
}

// --- Test 14 (shipped export-authority.json): real captured rows verify ---
// The REAL shipped authority export: in-mandate ALLOWED (seq 40448) +
// out-of-mandate DENIED (seq 40455). Both consistent; chain + mandate-logic OK.
{
  const exp = JSON.parse(readFileSync(join(HERE, 'export-authority.json'), 'utf8'));
  const r = runAuthority(exp);
  check('(l) shipped export-authority.json -> AUTHORITY OK (2 rows), exit 0',
    r.out.includes('seq=40448') && r.out.includes('IN-MANDATE') &&
    r.out.includes('seq=40455') && r.out.includes('OUT-OF-MANDATE') &&
    r.out.includes('AUTHORITY OK') && r.code === 0, `got: "${r.out}" (exit ${r.code})`);
}

if (failures === 0) {
  console.log('ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log(`${failures} TEST(S) FAILED`);
  process.exit(1);
}
