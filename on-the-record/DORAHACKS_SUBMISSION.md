# On the Record — THE RECEIPT

**An agent runtime where acting and proving the act are one transaction — and the judge can reproduce the whole proof offline, right now, with no network and no credits.**

---

## The reframe

Most submissions are *an agent that does a trick*: it acts, and somewhere — later, by a different component — a log gets written. That log can drift, lie, or be skipped. A misbehaving agent gets to write its own story after the fact.

On the Record collapses that gap. **The receipt *is* the action.** A single governed verb, `record-action`, runs one in-enclave transaction that decides *and* appends the tamper-evident evidence of the decision in the same write. There is no separate logging step to trust, because there is no separate logging step.

This is not a slide. It is built, registered on the Terminal 3 testnet, and released so you can re-derive every cryptographic claim with the network off.

---

## What it is — the substrate (THE RECEIPT)

A caller invokes `record-action`. Inside the enclave, in one transaction, the contract:

1. reads the caller's identity **from the host** (`calling_user_did`), never from the request body;
2. evaluates the grant policy → `allowed` or `denied`;
3. touches the secret **only inside the enclave** and returns a masked proof — the raw secret never crosses the WIT boundary;
4. appends the decision as a **salted, hash-chained row** to a contract-only trail.

A refusal is also a receipt: a denied call appends a `denied` row chained onto the prior row, so "the agent refused" is permanent, ordered evidence — not the *absence* of a log line.

Everything else derives from this one substrate:

- **Tamper-evidence** = the hash chain over receipts.
- **Cross-anchoring** = just *another receipt* — a `seal` row chained through the identical hash path.
- **Offline verification** = recomputing those hashes from a public salt with SHA-256.

One hash rule, used for every row (acts and seals alike):

```
hash = hex( SHA256( utf8(salt) ‖ hexdecode(prev_hash) ‖ canonical_json(record_without_hash) ) )
genesis prev_hash = 64 zeros
salt = public per-tenant string  "on-the-record:v1:<tenant_id>"   (shipped verbatim; NOT a secret)
row  = { seq, ts, caller_did, action, outcome('allowed'|'denied'), masked_secret, reason, prev_hash, hash }
```

Contract is Rust → wasm. Verbs: `record-action`, `revoke(target_did)` (owner-only), `get-audit` (owner-or-auditors), `head()` (returns the tail hash, appends nothing), `seal-peer(peer_did, peer_head)`, `reset` (owner-only).

---

## PROVEN ON TESTNET

Real, registered, on-chain artifacts — captured verbatim into the exports in this directory (we do not re-run testnet to verify; the rows already exist).

| Registration | Contract id | Account |
|---|---|---|
| Refusal demo (allowed → revoke → denied) | **107** | Account 2 |
| Cross-anchor, tenant A | **110** | Account 2 |
| Cross-anchor, tenant B | **111** | Account 3 |

**The refusal chain** (`export.json`) — acting and refusing are *both* receipts:

- **ALLOWED** — `seq 29263`, `prev_hash` = 64 zeros (genesis).
- grant revoked (`revoke`, owner-only).
- **DENIED-after-revoke** — `seq 29270`, `reason: no_active_grant`, **chained directly onto the allowed row**.

You cannot keep the convenient `allowed` row and quietly drop the inconvenient `denied` one: editing or removing either breaks the chain at that seq.

**The cross-anchor** (`export-a2.json` / `export-a3.json`) — `CROSS-ANCHOR OK` on real testnet data; neither tenant can rewrite its history without breaking the other's anchor:

- **A2** (Account 2, id 110) — head `4e9e…0619` (seq 35984), and it **anchors A3's real head `c4ac…8411`**.
- **A3 seal** (Account 3, id 111) — `seq 29406`, head `c4ac…8411`, and it **anchors A2's real head `0092…e07a`**.

Each tenant binds the **other's real head**, so the binding holds in both directions. Forging the record requires corrupting two separately-claimed tenants at once, not one.

**The keyless agent** (`export-agent.json`) — a key-free agent reached the chain only through the MCP custody proxy and produced **3 autonomous acts**, each chained onto the head it had just observed:

| seq | action | outcome |
|---|---|---|
| 29680 | `load-policy` | allowed |
| 29686 | `process-batch:invoices` | allowed |
| 29692 | `flag-anomaly:txn-4471` | allowed |

All on contract id 111. The export verifies **CHAIN OK 5 rows** (Account 3's seal `seq 29406` + the proxy-proof act `seq 29652` + the three new agent acts). Account 3 finished above the 10,000-credit floor; Account 2 was never used.

---

## RUN IT YOURSELF IN 30 SECONDS (no network, no SDK, no credits)

Pure Node, built-in `crypto` only.

```bash
# 0) One-command narrated walkthrough — registers nothing, exits 0:
node on-the-record/demo.mjs

# 1) The refusal chain verifies end-to-end:
node on-the-record/verifier.mjs on-the-record/export.json
#    -> CHAIN OK 2 rows

# 2) The two tenants genuinely anchor each other (both directions bind real heads):
node on-the-record/verifier.mjs --cross on-the-record/export-a2.json on-the-record/export-a3.json
#    -> CROSS-ANCHOR OK (A head=4e9e…0619 bound in B; B head=c4ac…8411 bound in A)

# 3) Tamper test — flip one byte in any row of export.json (don't recompute its hash), re-run #1:
#    -> BROKEN AT seq=<the row you touched>

# 4) The verifier's own suite (24 checks: chains, tamper, cross-anchor OK/WEAK/MISMATCH, + adversarial forgery/shadow/rewrite/broken-peer):
node on-the-record/verifier.test.mjs
#    -> ALL TESTS PASSED
```

And open **`on-the-record/filmstrip.html`** in a browser: an interactive integrity toy that recomputes the chain hashes live in-page — drag a byte and watch the chain break. Its crypto matches the CLI verifier exactly.

All four CLI commands above were run for this submission: `demo.mjs` exits 0, `CHAIN OK 2 rows`, `CROSS-ANCHOR OK`, `24/24`.

---

## SDK INTEGRATION DEPTH

The receipt substrate is wired through real SDK surfaces, end to end — exercised, not aspirational:

- **`contracts.register`** — the refusal contract (id 107) and both cross-anchor tenants (ids 110 / 111) registered through the SDK path (multipart wasm, version bump).
- **Cross-tenant `executeAndDecode`** — the seal transport: tenant A reads B's `head()` and submits `seal-peer(...)`, symmetrically, over the proven client execute/decode path. The cross-anchor rides existing transport, not a side channel.
- **Contract-scoped map ACLs** — the audit trail is a contract-only map; reads gated to owner / designated auditors.
- **`executeControl` control-plane seeding** — grants seeded via the control plane (map-entry-set), then enforced in-enclave; `revoke` flips the grant so the next call produces the `denied` receipt above.
- **In-enclave host context** — `calling_user_did()` (unforgeable caller identity), `seq_no()` (host-stamped ordering, used as the row key), `cluster_timestamp_secs()` (host-stamped time), `kv_store` (per-tenant namespaced storage), and masked secrets (read in-enclave, only `mask()` output crosses the boundary).
- **`did:t3n` ETH auth** — callers and owners are `did:t3n:<hex>` identities (handshake / authenticate); identity derives from the host, never the body.
- **`get-audit`** — owner/auditor-scoped export of the chain (with its public salt) so the trail can be pulled and verified entirely offline.
- **A real MCP stdio server** — `@modelcontextprotocol/sdk`: the custody proxy is a genuine MCP server with a genuine MCP `Client` (tier 1, not a mock). It holds Account 3's key in a closure and exposes only `act / head / verify / file`; no tool input field is key-shaped, and a negative check confirms the keyless agent cannot construct a signer.

---

## HONEST LIMITS

Stated plainly, because the entry is named "On the Record."

- **Tamper-EVIDENT, not tamper-PROOF.** The chain does not *prevent* modification; it makes any modification *detectable*. An adversary with full write access can rewrite rows — but not without the verifier reporting `BROKEN AT` (or `CROSS-ANCHOR MISMATCH`). The guarantee is detection.
- **Cross-anchor is a mechanism demonstrated with two accounts we control.** What is proven is the *mechanism*: two separately-claimed tenants pinning each other's heads so neither can rewrite alone. Full independent-operator trust holds only when third parties run the peer anchors. We control both accounts here and say so.
- **No "cluster-signed" claim is made.** We deliberately do **not** assert receipts carry a cluster signature, because the SDK read path for that attestation (the CCF leaf) is absent from what we could exercise. Stating it would be guessing — so we file it instead (below).

The guarantee is framed as **category + completion** — what kind of property it is, and that it is actually built and verifiable — never as a confidence percentage.

---

## Track-2 finding #1 — `set-claims-digest` is a write-only sink

The runtime exposes a `set-claims-digest` host call that writes a 32-byte SHA-256 into the CCF Merkle ledger leaf — the leaf whose whole purpose is the "cluster-signed, no-single-operator-to-trust" guarantee. **But no client read path exists.** A `grep -rin -E "claimsDigest|merkleProof|getProof|getReceipt|merkle"` over the entire installed `@terminal3/t3n-sdk` returns **zero matches** — no method to read the leaf, the Merkle proof, or the cluster receipt back. A contract can write the digest; no client can ever verify it, so the advertised trust model collapses to "trust the SDK / trust a node." Fix: add a `getClaimsDigest(txId) → { claimsDigest, merkleProof, receipt }` read plus an offline `verifyClaimsDigestReceipt(...)`, mirroring the SDK's existing `verifyTdxQuote` / `verifyDkgAttestation` pattern. Full reproduction in `../track2-report-01-claims-digest.md`. This is exactly why this entry does not claim "cluster-signed."

---

## Provenance

This entry is a clean-room reframe of an earlier contract by the same author into a general receipt runtime. The inherited in-enclave chassis and the genuinely new parts (salted hash-chain, generalized verb, offline verifier, dual-tenant cross-anchor, MCP custody proxy) are disclosed in full, up front, in `../PROVENANCE.md`.
