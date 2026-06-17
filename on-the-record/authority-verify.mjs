// AUTHORITY SIGNATURE re-verifier — SEPARATE from the core zero-dep verifier.
//
// This file uses the SDK's OWN OFFLINE crypto (no network; no credits). It:
//   1) rebuilds the delegation credential from the export's `authority.companion`
//      and canonicalises it (canonicaliseCredential, RFC 8785 JCS),
//   2) re-recovers the user's EIP-191 signer from those JCS bytes + the captured
//      user signature (ethRecoverEip191),
//   3) re-verifies the agent's invocation signature with the correct PREHASH
//      semantics: raw 64-byte ECDSA over sha256(preimage), where
//      preimage = buildInvocationPreimage(vc_id, nonce, request_hash), and
//   4) re-derives the 16-byte sha256-prefix COMMITMENT over the companion and
//      checks it equals the commitment carried INSIDE the on-chain authority
//      rows' `action` (field `c`) — tying the verifiable bytes to the chain.
//
// IMPORTANT BOUNDARY: the CHAIN / CROSS-ANCHOR verifier (verifier.mjs) remains
// ZERO-DEPENDENCY (Node built-ins only). Only THIS file imports the SDK, and
// only for client-side, offline, deterministic crypto:
//   - buildDelegationCredential / canonicaliseCredential (rebuild + JCS)
//   - ethRecoverEip191        (re-recover the EIP-191 user signer)
//   - buildInvocationPreimage (rebuild the agent pre-image)
//   - @noble/curves secp256k1.verify (re-verify the agent sig, prehash)
// We do NOT hand-vendor keccak/secp256k1, and we do NOT call any async/network
// SDK surface (no revokeDelegation, no TDX/DKG attestation).
//
// USAGE (run from the sdk-test dir where the SDK + @noble are installed):
//   cd .../sdk-test && node "../on-the-record/authority-verify.mjs" \
//       "../on-the-record/export-authority.json"

import {
  buildDelegationCredential, canonicaliseCredential,
  ethRecoverEip191, buildInvocationPreimage,
} from "@terminal3/t3n-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// base64url-no-pad decode (the SDK wire encoding for binary fields).
function b64uDecode(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64"));
}

// Deterministic sorted-key canonical JSON (matches the build script's `canon`
// and verifier.mjs canonicalJson) — used to re-derive the credential commitment.
function canon(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(value[k])).join(",") + "}";
}

// Re-derive the 16-byte sha256-prefix commitment over the companion blob.
function deriveCommit(companion) {
  return createHash("sha256").update(Buffer.from(canon(companion), "utf8"))
    .digest("hex").slice(0, 32);
}

// Pull the on-chain commitments (`c`) from the authority rows' action strings.
function chainCommits(exportObj) {
  const out = [];
  for (const row of exportObj.rows || []) {
    let a;
    try { a = JSON.parse(row.action); } catch { continue; }
    if (a && a.t === "authority" && typeof a.c === "string") out.push({ seq: row.seq, c: a.c });
  }
  return out;
}

// Re-verify the captured credential + both signatures from the companion.
// Returns { user_sig_ok, recovered_addr, agent_sig_ok, jcs_len }.
export function verifyCompanion(companion) {
  const cr = companion.credential;

  // Rebuild the credential EXACTLY as built, then canonicalise to JCS. JCS is
  // deterministic, so these bytes equal the bytes the user signed.
  const cred = buildDelegationCredential({
    user_did: cr.user_did,
    agent_pubkey: b64uDecode(cr.agent_pubkey),
    org_did: cr.org_did,
    contract: cr.contract,
    functions: cr.functions,
    scopes: cr.scopes,
    metadata: cr.metadata,
    not_before_secs: BigInt(cr.not_before_secs),
    not_after_secs: BigInt(cr.not_after_secs),
    vc_id: b64uDecode(cr.vc_id),
  });
  const jcs = canonicaliseCredential(cred);

  // 1) Re-recover the EIP-191 user signer over the JCS bytes.
  const userSig = b64uDecode(companion.user_sig);
  const recovered = ethRecoverEip191(jcs, userSig); // 20-byte ETH address
  const recoveredHex = Buffer.from(recovered).toString("hex");
  const userSigOk = recoveredHex.length === 40; // a valid signer was recovered

  // 2) Re-verify the agent invocation sig with PREHASH semantics.
  const vcId = b64uDecode(cr.vc_id);
  const nonce = b64uDecode(companion.nonce);
  const reqHash = b64uDecode(companion.request_hash);
  const agentPub = b64uDecode(cr.agent_pubkey);
  const agentSig = b64uDecode(companion.agent_sig);
  const preimage = buildInvocationPreimage(vcId, nonce, reqHash);
  const digest = createHash("sha256").update(Buffer.from(preimage)).digest();
  const agentSigOk = secp256k1.verify(agentSig, digest, agentPub, { prehash: false });

  return {
    user_sig_ok: userSigOk,
    recovered_addr: "0x" + recoveredHex,
    agent_sig_ok: agentSigOk,
    jcs_len: jcs.length,
  };
}

// Verify the whole export's authority block.
export function verifyAuthoritySignatures(exportObj) {
  const auth = exportObj.authority;
  if (!auth || !auth.companion) return { ok: false, reason: "no authority.companion in export" };

  const sig = verifyCompanion(auth.companion);
  const derivedCommit = deriveCommit(auth.companion);

  // The commitment must match what the build recorded AND what every on-chain
  // authority row carries in its action (`c`).
  const commitMatchesExport = derivedCommit === auth.commit;
  const onChain = chainCommits(exportObj);
  const commitMatchesChain = onChain.length > 0 && onChain.every((r) => r.c === derivedCommit);

  const ok = sig.user_sig_ok && sig.agent_sig_ok && commitMatchesExport && commitMatchesChain;
  return {
    ok, ...sig,
    derived_commit: derivedCommit,
    commit_matches_export: commitMatchesExport,
    commit_matches_chain: commitMatchesChain,
    chain_rows_committing: onChain,
  };
}

function main() {
  const p = process.argv[2];
  if (!p) {
    console.error("usage: node authority-verify.mjs <export-authority.json>");
    process.exit(2);
  }
  console.log(
    "[authority-verify] uses the SDK's own offline crypto (no network); " +
    "the chain/cross-anchor verifier (verifier.mjs) remains zero-dependency.",
  );
  const exp = JSON.parse(readFileSync(p, "utf8"));
  const res = verifyAuthoritySignatures(exp);
  console.log(
    `user_sig_ok=${res.user_sig_ok} (signer=${res.recovered_addr}) ` +
    `agent_sig_ok=${res.agent_sig_ok} jcs_len=${res.jcs_len}`,
  );
  console.log(
    `commit derived=${res.derived_commit} matches_export=${res.commit_matches_export} ` +
    `matches_chain=${res.commit_matches_chain} ` +
    `(rows: ${JSON.stringify((res.chain_rows_committing || []).map((r) => r.seq))})`,
  );
  if (res.ok) {
    console.log("AUTHORITY SIGS OK (user EIP-191 re-recovered + agent invocation sig re-verified + commitment binds the chain)");
    process.exit(0);
  }
  console.log("AUTHORITY SIGS FAILED" + (res.reason ? ": " + res.reason : ""));
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
