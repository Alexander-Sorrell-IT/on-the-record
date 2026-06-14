// CLIENT-SIDE filing renderer for the "On the Record" receipt chain.
// Pure Node ESM. ZERO SDK. ZERO network. ZERO testnet ops.
//
// Reads a verified export JSON and emits a print-ready REGULATOR/AUDIT FILING
// (markdown), modeled loosely on an EU AI Act Article 12 logging extract plus a
// plain audit pack. Every entry CITES the evidence hash that substantiates it
// (the row's own hash + its prev_hash link), so each line is traceable to the
// on-chain hash-chain.
//
// REFUSAL RULE: it re-runs the same chain-verification logic as verifier.mjs and
// REFUSES to render if the chain is BROKEN. A filing must only render over a
// verified chain.
//
// Usage:
//   node render-filing.mjs [export.json] [filing.md]
// Defaults: ./export.json -> ./filing.md

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyChain, chainHead, parseSeal } from './verifier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// EU AI Act Art. 12 ("Record-keeping") requires automatically generated logs of
// events over the system's lifetime; this maps each receipt row to such a log
// entry, with the chain hash as the tamper-evident reference.
const SYSTEM_NAME = 'On the Record — grant-checked action receipt ledger';

function isoUtc(tsSeconds) {
  return new Date(tsSeconds * 1000).toISOString();
}

function decisionLine(row) {
  if (row.outcome === 'denied') {
    const reason = row.reason && row.reason.length ? row.reason : '(no reason recorded)';
    return `DENIED — reason: ${reason}`;
  }
  if (row.outcome === 'allowed') {
    return row.reason && row.reason.length ? `ALLOWED — ${row.reason}` : 'ALLOWED';
  }
  return `${String(row.outcome).toUpperCase()}${row.reason ? ` — ${row.reason}` : ''}`;
}

// Human-readable rendering of the action field. Seal rows carry a JSON action;
// surface them as a cross-anchor seal rather than raw JSON.
function actionLine(row) {
  const seal = parseSeal(row);
  if (seal) {
    return `cross-anchor seal of peer ${seal.peer_did} @ head ${seal.peer_head}`;
  }
  return row.action;
}

function maskedSecretLine(row) {
  if (row.masked_secret && row.masked_secret.length) {
    return `\`${row.masked_secret}\` (masked — full secret never leaves the boundary)`;
  }
  return '(none — no secret was exercised on this action)';
}

export function renderFiling(exportObj, sourcePath) {
  const result = verifyChain(exportObj);
  if (!result.ok) {
    throw new Error(
      `REFUSING TO RENDER: chain is BROKEN AT seq=${result.brokenSeq}. ` +
        `A filing must only be produced over a verified chain.`,
    );
  }
  if (!Array.isArray(exportObj.rows) || exportObj.rows.length === 0) {
    throw new Error(
      'REFUSING TO RENDER: empty chain (no receipt rows to attest). ' +
        'A filing must attest at least one receipt.',
    );
  }

  const rows = [...exportObj.rows].sort((a, b) => a.seq - b.seq);
  const head = chainHead(exportObj);
  // Derive the attested identity/salt from EXACTLY the field verifyChain hashes
  // (exportObj.salt), so the displayed tenant DID + salt match the chain that was
  // cryptographically verified — not a separate salt_string that could diverge.
  const salt = exportObj.salt || '';
  const tidMatch = /:v1:([0-9a-f]+)$/.exec(salt);
  const tenantDid = tidMatch ? `did:t3n:${tidMatch[1]}` : '(unknown — salt not in expected form)';
  const genUtc = new Date().toISOString();

  const L = [];

  // ---- Header --------------------------------------------------------------
  L.push('# Regulator / Audit Filing — Receipt Chain Logging Extract');
  L.push('');
  L.push('_Loosely modeled on an EU AI Act Article 12 (record-keeping) logging extract plus a plain audit pack._');
  L.push('');
  L.push('| Field | Value |');
  L.push('| --- | --- |');
  L.push(`| System | ${SYSTEM_NAME} |`);
  L.push(`| Tenant DID (derived from public salt) | \`${tenantDid}\` |`);
  L.push(`| Domain-separation salt (public) | \`${salt}\` |`);
  L.push(`| Chain head hash | \`${head}\` |`);
  L.push(`| Receipt rows in filing | ${rows.length} |`);
  L.push(`| Verification status | CHAIN OK (${result.n} rows, recomputed client-side) |`);
  L.push(`| Generated from | \`${sourcePath}\` |`);
  L.push(`| Generated at (UTC) | ${genUtc} |`);
  L.push('');
  L.push(
    '> Evidence model: each row\'s `hash = SHA256( salt || prev_hash_bytes || canonical_json(row\\ hash) )`. ' +
      'Each entry below CITES its own evidence hash and its `prev_hash` link to the prior row, so every ' +
      'line is independently traceable along the salted hash-chain back to genesis ' +
      '(`prev_hash = ' + '0'.repeat(64) + '`).',
  );
  L.push('');
  L.push('---');
  L.push('');
  L.push('## Receipt Entries');
  L.push('');

  // ---- One entry per receipt row ------------------------------------------
  rows.forEach((row, i) => {
    L.push(`### Entry ${i + 1} — receipt seq ${row.seq}`);
    L.push('');
    L.push(`- **Sequence:** ${row.seq}`);
    L.push(`- **Timestamp:** ${isoUtc(row.ts)} (unix ${row.ts})`);
    L.push(`- **Actor DID:** \`${row.caller_did}\``);
    L.push(`- **Action:** ${actionLine(row)}`);
    L.push(`- **Decision:** ${decisionLine(row)}`);
    L.push(`- **Masked secret proof:** ${maskedSecretLine(row)}`);
    L.push('- **Evidence (cited hash):**');
    const isGenesis = row.prev_hash === '0'.repeat(64);
    L.push(
      `  - prev_hash link: \`${row.prev_hash}\`` +
        (isGenesis ? ' (genesis — first row in chain)' : ' (links to the prior entry above)'),
    );
    L.push(`  - this row hash: \`${row.hash}\``);
    L.push('');
  });

  // ---- Footer / attestation ------------------------------------------------
  L.push('---');
  L.push('');
  L.push('## Attestation');
  L.push('');
  L.push(
    `This filing was rendered only after the full chain (${result.n} rows) was re-verified ` +
      'client-side using the same hash rule as the offline verifier. The chain head ' +
      `\`${head}\` is the cryptographic commitment to all entries above; altering any ` +
      'field of any row would change that row\'s hash and break the cited `prev_hash` ' +
      'links for every subsequent entry, which the verifier would detect.',
  );
  L.push('');

  return L.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const sourcePath = resolve(argv[0] || resolve(HERE, 'export.json'));
  const outPath = resolve(argv[1] || resolve(HERE, 'filing.md'));

  const exportObj = JSON.parse(readFileSync(sourcePath, 'utf8'));
  let md;
  try {
    md = renderFiling(exportObj, sourcePath);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  writeFileSync(outPath, md, 'utf8');
  console.log(`FILING RENDERED -> ${outPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
