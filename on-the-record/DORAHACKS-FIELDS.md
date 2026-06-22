# DoraHacks submission — paste-ready fields (On the Record)

Standard hackathon project fields (DoraHacks BUIDL "Full description" expands these). All copy is grounded in what's built and proven on testnet — no new claims.

## Project name
On the Record

## Tagline (~200 chars)
A live, no-single-point-of-trust mesh where AI agents verify each *other*: as a task is relayed agent→agent, each receiver reads the sender's unforgeable `did:t3n` inside its own TEE and binds it before acting — random-routed, re-walkable offline by anyone.

## Try it
Repo: https://github.com/Alexander-Sorrell-IT/on-the-record · re-walk the live mesh offline (no install, no network, no credits): `node on-the-record/verifier.mjs relay-build/export-A.json` then `node on-the-record/verifier.mjs --cross relay-build/export-A.json relay-build/export-B.json`

## Demo video
https://youtu.be/V9N4a8xXhYE

## Track
Track 1 — Best Agent utilising the Terminal 3 Agent Auth SDK. (Track-2 bug reports filed separately on DoraHacks.)

---

## Inspiration
Agents are starting to act *through* each other — one agent calling the next. The danger isn't only that you can't audit an agent after the fact; it's that at the moment of action there's no one trustworthy to vouch for it. You can't trust a single agent, and you can't trust a single fixed validator either — it can be bribed, or it goes down. What's missing is a *topology*: a way for agents to verify each **other**, with no single point of trust, and to prove it afterward without re-running anything. Every era of automation gets its accountability layer; multi-agent systems need one where the agents check each other in flight.

## What it does
**On the Record is a live trust *topology* for multi-agent action — agents verify each *other*, with no single point of trust.** As a task is relayed between agents, the receiving agent must — inside its own Terminal 3 TEE — read the sender's **unforgeable `did:t3n`**, independently re-fetch and confirm the sender's chain head, and **mutually cross-anchor** it into its own ledger *before* the work advances. The next verifier is a **random draw pinned by the chain hash** — recomputable by anyone, gameable by none, so there's no fixed bribable validator; every node both verifies and is verified. Authority is enforced *in the path*: revoke an agent's grant and its next action is **refused and recorded** (`outcome=denied`) — it cannot act off the record. And because every step is a salted, hash-chained, mutually cross-anchored receipt, **anyone re-walks the whole route offline** — `CHAIN OK`, `CROSS-ANCHOR OK`; tamper one byte → `BROKEN`, forge a vouch that never happened → `MISMATCH`. **Proven live on testnet:** a randomized 3-node relay `A→B→C`, every hop `caller=OK match=OK`, both traversed pairs `CROSS-ANCHOR OK`, and a revoked peer's hop correctly `denied`.

## How we built it
The relay is **cross-tenant `executeAndDecode`**: at each hop the sender invokes the *next* agent's own contract, whose enclave stamps the **unforgeable `calling_user_did()`** — that is the in-path identity gate, not a signature the sender could fake. The receiver independently re-reads the sender's `head()` and **mutually `seal-peer`s** (each node seals the other's head), so the offline verifier grades the pair `CROSS-ANCHOR OK` in both directions. The next-hop is `parseInt(myHead.slice(-8),16) % candidates` — **committed by the chain hash and recomputable by any verifier**, so no node can steer who checks it. It all runs on the already-deployed `on-the-record` contract (Rust→`wasm32-wasip2`, Terminal 3 TEE; reads `calling_user_did`/`seq_no`/`cluster_timestamp_secs`, enforces grants in-enclave, appends `hash = SHA256(salt ‖ prev_hash ‖ canonical(record))`) — **zero re-deploy, zero new WASM.** **Platform finding (a Track-2 headline):** cross-tenant invoke is **not 10k-gated** — a caller holding just **1,203 credits** makes a *paid* cross-tenant `record-action` the host accepts (`allowed`, caller stamped in-enclave, ~151cr charged; reproduce via `relay-build/probe_subfloor.mjs`). The `403 required=10000` error only surfaces on 0-credit/unclaimed identities, so the widely-assumed "≥10k to invoke" is false for invocation. SDK surface: `did:t3n` ETH auth, `contracts.register`, cross-tenant `executeAndDecode`, contract-scoped map ACLs, `executeControl` for grant/revoke. The receipt layer — salted hash-chain + the **zero-dependency offline verifier** (`CHAIN OK` / tamper→`BROKEN` / `CROSS-ANCHOR OK` / forge→`MISMATCH`, with 36 self-tests, zero false-passes) — is the *proof* the route happened as claimed: the byproduct of routing, not the product. **Honest scope:** with 3 same-owner accounts this proves the *mechanism* of committed, recomputable, non-retro-rollable random selection — the property that scales to statistical non-collusion at large N; we never claim "a jury of strangers."

## Challenges we ran into
Making *no single point of failure* real, not rhetorical. Our first cross-anchor sealed a peer at genesis (which binds nothing) — an adversarial review caught it, we hardened the verifier to a provably-sound three-state check (OK / WEAK / MISMATCH) and re-derived real cross-anchored exports so it now reports `OK` on live data. Keeping the agent genuinely keyless took a custody boundary the agent process never sees. And honesty under pressure: it's tamper-**evident**, not tamper-**proof**, and the SDK can't read its own attestation leaf — so instead of claiming "cluster-signed," we filed that as a bug report.

## Accomplishments that we're proud of
A verifier whose 36-check suite catches every adversarial forgery, shadow-seal, post-anchor-rewrite, broken-peer and out-of-mandate-escape case with zero false-passes. An entry a stranger reproduces offline in 30 seconds with no install, network, or credits. One Rust contract substrate powering the chain, the cross-anchor, the filing, the verifier format, and the keyless-agent proxy — the category lives in the function, not the surface. And 11 reproduction-backed Terminal 3 platform bug/DX reports produced as exhaust of building honestly.

## What we learned
Honesty is the product. "Tamper-evident, not tamper-proof" and "the agent holds no keys" answer more judge questions in a sentence than any diagram. Show your math or it's just a claim — every receipt cites its hash, every filing line cites its evidence, the verifier is the spec. An accountability layer that can't itself be audited isn't one.

## What's next for On the Record
Independent third-party anchors (today's cross-anchor proves the mechanism on two accounts we control; true independence is when separate organizations run the anchors). A registry where any agent enrolls and gets cross-witnessed. And network-enforced "no receipt, no act" — which only the platform can ship, and which this entry is the working argument for.

## Authority / delegation (second crypto surface)
The receipt substrate answers *what happened*. A second surface answers *was the agent even allowed to*. A user signs a **delegation credential** — `{user_did, agent_pubkey, org_did, contract, functions[], cap, validity window, vc_id}` — canonicalised with **RFC 8785 JCS** and signed **EIP-191** by the user; the agent then signs each invocation (raw secp256k1 over `sha256(preimage)`). On-chain, every authority act carries a 16-byte sha256-prefix **commitment** to that credential, so the mandate is bound into the same hash-chained rows as the acts it governs (`export-authority.json`: in-mandate `execute-disbursement` $4,200 ≤ cap **ALLOWED** seq 40448; over-cap $25,000 > cap **REFUSED** seq 40455).

Honest split of where the crypto lives:
- **Core verifier stays zero-dependency.** `verifier.mjs --authority` does only the **mandate LOGIC** — pure JSON parse + comparison: `in_mandate ⇔ fn ∈ functions[] AND amount ≤ cap`, and the hard invariant *no out-of-mandate row may be `allowed`*. No crypto, no SDK. Covered by the verifier self-tests (in-mandate allow, out-of-mandate deny, and the soundness escape — an out-of-mandate ALLOW — caught).
- **Signature re-verification is a SEPARATE file using the SDK's own offline crypto.** `authority-verify.mjs` imports the SDK (`buildDelegationCredential` / `canonicaliseCredential` / `ethRecoverEip191` / `buildInvocationPreimage`) + `@noble/curves`, all **offline, no network** — it rebuilds the credential to JCS, re-recovers the EIP-191 signer, re-verifies the agent invocation sig with prehash semantics, and re-derives the commitment to check it matches both the export companion and the on-chain rows.
- **Stated honestly:** the per-act binding to the *correct* user is enforced by the **commitment matching the chain** (tamper the credential → the recomputed commitment stops matching → overall verify fails), not by the recovered-signer field alone. The core zero-dep claim is unaffected: only `authority-verify.mjs` touches the SDK.

## Provenance — distinct from our beta entry (disclosed up front)
The contract is a clean-room reframe of the same author's beta-edition BUIDL, *Terminal 3 Agent Mesh* (`github.com/Alexander-Sorrell-IT/terminal3-agent-mesh`) — a **different product**: an agent **spending-governance** demo (`purchase()`, per-tx/cumulative spend caps). On the Record is a **different category** — a no-single-point-of-trust **verification mesh** over a *receipt runtime* (the receipt is the proof, not the product). **Inherited:** only the in-enclave chassis (host identity, `kv_store`, secret masking, audit-write). **New here:** the live randomized cross-anchor relay mesh, the salted hash-chain, generalized `record-action`, the offline verifier, the mutual cross-anchor, the keyless MCP custody proxy, and the delegation/authority crypto surface. Different thesis, different demo, ~70% new code — and the Track-2 bug reports are deduped against the beta's findings (filed separately on DoraHacks). Full accounting in `PROVENANCE.md`.

## Built With (tags)
rust, wasm, wasm32-wasip2, typescript, nodejs, ethereum, did:t3n, eip-191, jcs, mcp, terminal3-sdk, sha-256, secp256k1, tee, agent-auth
