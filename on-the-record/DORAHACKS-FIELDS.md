# DoraHacks submission — paste-ready fields (On the Record)

Standard hackathon project fields (DoraHacks BUIDL "Full description" expands these). All copy is grounded in what's built and proven on testnet — no new claims.

## Project name
On the Record

## Tagline (~200 chars)
A compliance-native runtime where an AI agent's every action — and every refusal — is born as a tamper-evident, hash-chained receipt inside a TEE. Cross-anchored across tenants. Reproducible offline in 30 seconds.

## Try it
Repo: https://github.com/Alexander-Sorrell-IT/on-the-record · one command: `node on-the-record/demo.mjs` (no install, no network, no credits)

## Demo video
`<YouTube Unlisted link — upload on-the-record/demo-narrated.mp4>`

## Track
Track 1 — Best Agent utilising the Terminal 3 Agent Auth SDK. (Track-2 bug reports filed separately — see TRACK2-INDEX.md.)

---

## Inspiration
Nobody can prove what an AI agent actually did, and nobody can truly stop one mid-action — so no bank, government, or regulated business will let an agent touch anything real. The only record of an agent's intent is a sentence the agent wrote about itself. Every era of automation eventually gets its accountability layer: finance got double-entry bookkeeping, the web got HTTPS, supply chains got SBOMs. Agents that act on a user's behalf need theirs — and it has to be one the agent itself cannot edit.

## What it does
On the Record is a runtime where **acting and producing the evidence are one atomic transaction.** Every agent action — and every *refusal* — is written, inside a Terminal 3 TEE, as a salted, hash-chained receipt in the same indivisible step that performs it. You cannot keep the act and drop the proof. Revoke an agent's grant and its next action refuses itself, with the refusal recorded as the next link in the chain. Two independently-claimed tenants **cross-anchor** each other's chains, so no single operator can rewrite history (verified: `CROSS-ANCHOR OK`; forge a head → `MISMATCH`). The agent **holds no keys** — it reaches the chain only through an MCP custody proxy, so it literally cannot act off the record. From the same chain we render a regulator filing where every line cites the evidence hash that proves it. A judge reproduces every integrity claim **offline in 30 seconds**, zero dependencies.

## How we built it
One substrate — **THE RECEIPT** — underpins every surface. A Rust→`wasm32-wasip2` contract on the Terminal 3 TEE reads the unforgeable caller `did:t3n`, host `seq_no`/`cluster_timestamp`, enforces policy in-enclave, computes `hash = SHA256(salt ‖ prev_hash ‖ canonical(record))`, and appends exactly one chained row. SDK integration spans the surface: `contracts.register`, cross-tenant `executeAndDecode`, contract-scoped map ACLs, `executeControl` control-plane seeding, in-enclave `calling_user_did`/`seq_no`/`cluster_timestamp_secs`/`kv_store`/masked-secrets, `did:t3n` ETH auth, `get-audit`, and a real MCP stdio server (`@modelcontextprotocol/sdk`) as the custody proxy. Clients: a zero-dependency offline verifier (CHAIN OK / tamper→BROKEN / CROSS-ANCHOR OK), a filing renderer, and a keyless Claude-CLI agent. Proven on testnet (contracts 107 / 110 / 111). Verification a judge can run: Rust unit tests, the on-chain integration, a cold-start zero-dependency reproduction, and **24 verifier self-tests** (`verifier.test.mjs`) — including adversarial forgery, shadow-seal, post-anchor-rewrite and broken-peer cases, all caught with **zero false-passes**.

## Challenges we ran into
Making *no single point of failure* real, not rhetorical. Our first cross-anchor sealed a peer at genesis (which binds nothing) — an adversarial review caught it, we hardened the verifier to a provably-sound three-state check (OK / WEAK / MISMATCH) and re-derived real cross-anchored exports so it now reports `OK` on live data. Keeping the agent genuinely keyless took a custody boundary the agent process never sees. And honesty under pressure: it's tamper-**evident**, not tamper-**proof**, and the SDK can't read its own attestation leaf — so instead of claiming "cluster-signed," we filed that as a bug report.

## Accomplishments that we're proud of
A verifier whose 24-check suite catches every adversarial forgery, shadow-seal, post-anchor-rewrite and broken-peer case with zero false-passes. An entry a stranger reproduces offline in 30 seconds with no install, network, or credits. One Rust contract substrate powering the chain, the cross-anchor, the filing, the verifier format, and the keyless-agent proxy — the category lives in the function, not the surface. And 11 reproduction-backed Terminal 3 platform bug/DX reports produced as exhaust of building honestly.

## What we learned
Honesty is the product. "Tamper-evident, not tamper-proof" and "the agent holds no keys" answer more judge questions in a sentence than any diagram. Show your math or it's just a claim — every receipt cites its hash, every filing line cites its evidence, the verifier is the spec. An accountability layer that can't itself be audited isn't one.

## What's next for On the Record
Independent third-party anchors (today's cross-anchor proves the mechanism on two accounts we control; true independence is when separate organizations run the anchors). A registry where any agent enrolls and gets cross-witnessed. And network-enforced "no receipt, no act" — which only the platform can ship, and which this entry is the working argument for.

## Built With (tags)
rust, wasm, wasm32-wasip2, typescript, nodejs, ethereum, did:t3n, mcp, terminal3-sdk, sha-256, tee, agent-auth
