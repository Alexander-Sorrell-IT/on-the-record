// demo.mjs — the whole "On the Record" story in ONE offline command.
//
// Pure Node ESM. ZERO network. ZERO testnet. ZERO credits. ZERO SDK.
// It reuses the EXPORTED functions of verifier.mjs (no hashing reimplemented)
// and render-filing.mjs, run against the REAL testnet-captured exports already
// shipped in this directory. A judge runs:  node demo.mjs
//
// On success it exits 0. Any unexpected result aborts non-zero.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  verifyChain,
  verifyCrossAnchor,
  chainHead,
  computeHash,
} from './verifier.mjs';
import { renderFiling } from './render-filing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = (name) => resolve(HERE, name);
const load = (name) => JSON.parse(readFileSync(P(name), 'utf8'));

// ---- tiny presentation helpers ------------------------------------------
const BAR = '='.repeat(72);
let sectionNo = 0;
function header(title) {
  sectionNo += 1;
  console.log('');
  console.log(BAR);
  console.log(`  ${sectionNo}) ${title}`);
  console.log(BAR);
}
function line(s = '') {
  console.log(s);
}
// Abort loudly if an invariant the demo asserts does not actually hold.
function must(cond, msg) {
  if (!cond) {
    console.error(`\nDEMO ABORTED — expected invariant failed: ${msg}`);
    process.exit(1);
  }
}
const short = (h) => `${h.slice(0, 12)}…${h.slice(-12)}`;
const rowOf = (exp, seq) => exp.rows.find((r) => r.seq === seq);

line('');
line('ON THE RECORD — offline proof walkthrough');
line('Pure Node. No network, no testnet, no credits. Reusing verifier.mjs.');

// =========================================================================
// 1) ACT + EVIDENCE ARE ONE TRANSACTION
// =========================================================================
header('ACT + EVIDENCE ARE ONE TRANSACTION');
{
  const exp = load('export.json');
  const res = verifyChain(exp);
  must(res.ok, 'export.json must verify CHAIN OK');
  line(`verifier.mjs export.json  ->  CHAIN OK ${res.n} rows`);
  line('');

  const allowed = rowOf(exp, 29263);
  const denied = rowOf(exp, 29270);
  must(allowed && allowed.outcome === 'allowed', 'seq 29263 must be allowed');
  must(
    denied && denied.outcome === 'denied' && denied.reason === 'no_active_grant',
    'seq 29270 must be denied no_active_grant',
  );

  line('ALLOWED act (the grant was live):');
  line(`  seq        ${allowed.seq}`);
  line(`  action     ${allowed.action}`);
  line(`  outcome    ${allowed.outcome}`);
  line(`  secret     ${allowed.masked_secret}   (masked — raw key never leaves the boundary)`);
  line(`  hash       ${allowed.hash}`);
  line('');
  line('DENIED act AFTER the grant was revoked:');
  line(`  seq        ${denied.seq}`);
  line(`  action     ${denied.action}`);
  line(`  outcome    ${denied.outcome}`);
  line(`  reason     ${denied.reason}`);
  line(`  prev_hash  ${denied.prev_hash}`);
  line('');
  must(denied.prev_hash === allowed.hash, "denied.prev_hash must equal allowed.hash");
  line('  ^ the DENIED row\'s prev_hash == the ALLOWED row\'s hash.');
  line('    The refusal is not a log line off to the side — it is the NEXT link');
  line('    in the same hash-chain. The act and the evidence are one transaction:');
  line('    you cannot keep the act and drop the refusal.');
}

// =========================================================================
// 2) TAMPER-EVIDENT
// =========================================================================
header('TAMPER-EVIDENT');
{
  const original = load('export.json');
  const clean = verifyChain(original);
  must(clean.ok, 'baseline export.json must verify');
  line(`baseline                  ->  CHAIN OK ${clean.n} rows`);
  line('');

  // Flip a single byte of a real field, in-memory only (no file touched).
  const tampered = JSON.parse(JSON.stringify(original));
  const victim = rowOf(tampered, 29263);
  const before = victim.action;
  const last = before.slice(-1);
  victim.action = before.slice(0, -1) + (last === '2' ? '3' : '2');
  line(`flip ONE byte of seq ${victim.seq} action:`);
  line(`  was  "${before}"`);
  line(`  now  "${victim.action}"`);
  line('');

  const broken = verifyChain(tampered);
  must(!broken.ok, 'tampered chain must NOT verify');
  line(`verify tampered copy      ->  BROKEN AT seq=${broken.brokenSeq}`);
  line('');

  // Restore = simply re-read the untouched original (the file was never written).
  const restored = verifyChain(load('export.json'));
  must(restored.ok, 'original must still verify after restore');
  line(`re-verify original        ->  CHAIN OK ${restored.n} rows  (file untouched; tamper was in-memory)`);
  line('');
  line('  One altered byte is caught at the exact row. This is tamper-EVIDENT,');
  line('  not tamper-PROOF: we do not stop a write, we make it impossible to hide.');
}

// =========================================================================
// 3) NO SINGLE POINT OF FAILURE
// =========================================================================
header('NO SINGLE POINT OF FAILURE');
{
  const a = load('export-a2.json');
  const b = load('export-a3.json');
  const cross = verifyCrossAnchor(a, b);
  must(cross.ok, 'a2/a3 cross-anchor must verify');
  line('verifier.mjs --cross export-a2.json export-a3.json:');
  line(`  ->  CROSS-ANCHOR OK`);
  line(`      A head ${short(cross.aHead)} sealed inside B`);
  line(`      B head ${short(cross.bHead)} sealed inside A`);
  line('');

  // Tenant B rewrites its OWN single row, then recomputes its own hash so that
  // B's chain STILL verifies CHAIN OK in isolation. The forgery is only exposed
  // because A's seal anchored B's *real* head, which B no longer exposes.
  const bForged = JSON.parse(JSON.stringify(b));
  const r0 = bForged.rows[0];
  r0.action = 'REWRITTEN-HISTORY';
  r0.hash = computeHash(bForged.salt, r0.prev_hash, r0); // self-consistent reseal

  const bAlone = verifyChain(bForged);
  must(bAlone.ok, 'self-consistently forged B must still verify ALONE');
  line('now tenant B rewrites its own row and re-seals its own hash:');
  line(`  B verified IN ISOLATION   ->  CHAIN OK ${bAlone.n} rows   (B fooled itself)`);

  const crossForged = verifyCrossAnchor(a, bForged);
  must(!crossForged.ok, 'forged-B cross-anchor must MISMATCH');
  line(`  cross-anchor against A    ->  CROSS-ANCHOR MISMATCH`);
  line(`      ${crossForged.reason}`);
  line('');
  line('  A self-consistent rewrite passes B\'s OWN verifier — but A already');
  line('  sealed B\'s previous head. To make the forgery stick, B would also have');
  line('  to rewrite A\'s independently-held chain. One tenant cannot rewrite');
  line('  history alone. (Shown here with two accounts we control: this is the');
  line('  mechanism; full independence is when third parties run the anchors.)');
}

// =========================================================================
// 4) THE AGENT HOLDS NO KEYS
// =========================================================================
header('THE AGENT HOLDS NO KEYS');
{
  const exp = load('export-agent.json');
  const res = verifyChain(exp);
  must(res.ok && res.n === 5, 'export-agent.json must verify CHAIN OK 5 rows');
  line(`verifier.mjs export-agent.json  ->  CHAIN OK ${res.n} rows`);
  line('');
  const agentSeqs = [29680, 29686, 29692];
  line('Three of these rows are acts performed by a keyless Claude agent,');
  line('routed through the MCP custody proxy (the proxy holds the key; the agent');
  line('never sees it). Each act still landed as a hash-linked receipt:');
  line('');
  for (const seq of agentSeqs) {
    const r = rowOf(exp, seq);
    must(r && r.outcome === 'allowed', `agent row seq ${seq} must be allowed`);
    line(`  seq ${r.seq}  ${r.outcome.padEnd(8)} ${r.action.padEnd(24)} secret=${r.masked_secret}`);
    line(`            hash ${short(r.hash)}`);
  }
  line('');
  line('  The agent decided WHAT to do; the proxy held the authority to do it.');
  line('  The raw key appears in 0 shipped files — only masked proofs are recorded.');
}

// =========================================================================
// 5) THE FILING
// =========================================================================
header('THE FILING');
{
  const exp = load('export.json');
  const md = renderFiling(exp, P('export.json')); // refuses if chain is BROKEN
  const allLines = md.split('\n');

  line('render-filing.mjs over export.json (refuses to render a BROKEN chain):');
  line('');
  line('---- filing head ----');
  for (const l of allLines.slice(0, 18)) line(l);
  line('...');
  line('');

  // Every receipt entry cites its evidence hash. Prove it: one "this row hash"
  // citation per row in the chain.
  const citations = allLines.filter((l) => l.includes('this row hash:')).length;
  must(
    citations === exp.rows.length,
    `every row (${exp.rows.length}) must cite its evidence hash; found ${citations}`,
  );
  line(`evidence-hash citations in filing: ${citations} (one per receipt row — every line is traceable)`);
}

// =========================================================================
// CLOSING
// =========================================================================
line('');
line(BAR);
line('  A released, offline-reproducible receipt runtime: every grant-checked');
line('  act — including its refusal — is sealed into one tamper-evident,');
line('  cross-anchored, keyless-agent-safe hash-chain, and you just reproduced');
line('  the entire proof with no network, no testnet, and no credits.');
line(BAR);
line('');

process.exit(0);
