# BUILD PLAN — "On the Record" / THE RECEIPT

**Status:** Design closed. Foundation proven on-chain (2026-06-13). This is the executable plan.
**Deadline:** 2026-06-22 23:59 GMT+8 · **We submit Jun 21** (one-day buffer).
**Builder:** solo (me) · **Your time:** ~minutes (account logins + a couple sign-offs, listed at bottom).

---

## The headline
A **released, running** agent runtime where *acting and producing the tamper-evident evidence are one atomic in-enclave call*, **dual-tenant cross-anchored** so forging history requires corrupting two independently-claimed tenants. It wins by being a **complete, offline-reproducible new category** (the receipt runtime) — not a better entry in an existing one. The guarantee is **category + completion**, never a probability.

## Architecture (one substrate, everything derives from it)
- **THE RECEIPT** — one contract verb `act()` that in a single atomic transaction: reads the unforgeable caller DID (`calling_user_did()`) + host `seq_no()` + `cluster_timestamp_secs()`, enforces policy in Rust, reads `prev_hash` from its own tail row, computes `hash = SHA256(salt ‖ prev_hash ‖ canonical(record))`, and appends **exactly one** salted hash-chained row. You cannot act without leaving the receipt. **Refusal writes a `denied` row** (refusal-as-evidence — already in the chassis at `lib.rs:104`).
- **Cross-anchor (the no-SPOF fix):** Account 2 and Account 3 each seal the other's chain head into their own chain via the **proven** client-side `executeAndDecode` transport — `head()` returns the top hash, `seal_peer(peer_did, peer_head)` appends it as a normal row. Same call shape proven green today. *(We never touch the allowlist-gated in-enclave `contracts-call::invoke` — it needs a WIT bump + an operator allowlist row we can't set on testnet.)*
- **Key custody:** the agent holds **zero keys**. The MCP proxy holds the model key + the T3N keys; the agent reaches the chain only through recorded `act()`/`file()` verbs. Secrets are read only in-enclave and returned **masked**.
- **Trust anchor = salted prev_hash chain + dual-tenant cross-anchor + offline verifier.** None of these need a method that doesn't exist. We do **not** claim "cluster-signed / no operator to trust" — that SDK read path is confirmed absent (→ Track-2 report #1).

## Data model (the row)
Keyed by `{:020}` zero-padded `seq_no`. Fields: `seq, ts, caller_did, action, outcome(allowed|denied), masked_secret, prev_hash, hash`.
Chain rule: `hash = SHA256(salt ‖ prev_hash ‖ canonical_json(record_without_hash))`. Continuity holds iff every row N's `prev_hash == hash(row N-1)`.

---

## ⚠️ STEP 0 — the de-risk that comes before everything (critic's catch)
The chain assumes `kv_store::scan` returns rows **in ascending key order** so the tail = the true head. **This is the only unproven load-bearing primitive.** A 15-minute throwaway settles it: write 3 rows via the existing contract, `scan`, confirm order.
- If ordered → proceed.
- If not → sort the `{:020}` keys in-Rust before taking the tail (lexical sort is correct because of the zero-pad). Cheap fix, but we must **know**, not assume.

This runs **alongside** the probe re-run, before any spine code.

---

## Day-by-day (front half has NO slack — protect D1–D5)

| Day | Goal | Verify (pass/fail) |
|---|---|---|
| **D1 · Jun 13** *(largely done)* | **Prove `scan` ordering (Step 0).** Re-run `xtenant-probe.mjs` → `{pong:true}`, −1 credit. Clean-room reframe `z:mesh-seller → z:on-the-record` + **PROVENANCE NOTE**. Write salted `prev_hash` chaining (~20–40 LOC, `sha2`). | scan order confirmed (or sorted in-Rust) · wasm builds (~47s) · row N+1.prev_hash == hash(row N) · no `purchase/item/amount` framing remains |
| **D2 · Jun 14** | Generalize `purchase()` → `act(action, policy_ref)`. Register under Account 2; invoke `act()` cross-tenant from Account 3. | registers → contract_id · cross-tenant `act()` returns host-stamped row · a denied case writes `outcome:denied` · secret returns masked only |
| **D3 · Jun 15** | **Offline verifier (~80 LOC)** — the network-free floor. Export tooling pulls rows; verifier recomputes the chain. | CHAIN OK on clean export · flip one byte → exact break index + FAIL · runs with **network OFF** |
| **D4 · Jun 16** | **Cross-anchor live:** `head()` + `seal_peer()`; register under both accounts; orchestrator cross-stitches both chains; verifier validates it. | each chain carries the other's head · ~1 credit/seal · CROSS-ANCHOR OK · forged head → mismatch flagged |
| **D5 · Jun 17 — HARD CUT** | **Freeze a complete, submittable, offline-reproducible entry.** `file()` filing (itself a row) + write-up + **Track-2 report #1**. Tag the snapshot. | a fresh judge clones, runs verifier **offline** → CHAIN OK + CROSS-ANCHOR OK · report #1 reproduces from submitted materials |
| **D6 · Jun 18** | *Upgrade:* **MCP custody proxy** — agent owns zero keys, acts only via proxy verbs. | agent env has no T3N key; proxy does · each action = one row · spine unchanged |
| **D7 · Jun 19** | *Upgrade (deflated per critic):* **one** real breadth surface — read-only **examiner DID** (near-free). Other SDK surfaces **named in the write-up, not wired.** | examiner reads `get_audit()`; non-listed DID denied · no padding/feature-pile |
| **D8 · Jun 20** | Harden, scripted demo, finalize Track-2, cold-start dress rehearsal. Buffer. | clean-checkout rehearsal, no fixups · both accounts still >10k credits · no personal names; guarantee = category+completion |
| **D9 · Jun 21 — SUBMIT** | Submit on DoraHacks with confirmation. | accepted before EOD · judge reproduces offline from package |

> **Slack warning (critic):** D1–D5 are five consecutive must-land days; all the buffer is in D6–D8 (the wrong half). If D1–D3 wobble, treat **D4 as the real cut** and cross-anchor becomes the first upgrade.

## Spine — never cut (rides only proven primitives, and IS the entry)
1. Salted `prev_hash` chain (D1) 2. Generalized `act()` registered **and** invoked cross-tenant (D2) 3. Offline verifier (D3) 4. Dual-tenant cross-anchor over proven transport (D4) 5. `file()` row + frozen tagged package + PROVENANCE note + Track-2 #1 (D5)

## Cut order (drop first → last if time slips)
set-claims-digest write → Agent-Connect/payment touch → CLI → extra SDK-breadth enumeration → 2nd Track-2 report → MCP proxy (high value but entry is complete without it; keyless `agent-buyer.ts` loop stands in). **Never:** the spine.

## Track 2 (bug bounty as exhaust — self-paced to avoid the suspension lever)
- **#1 (locked, ready D5):** `set-claims-digest` is a **write-only sink** — no client read method (`claimsDigest/merkleProof/getProof/getReceipt/txProof`) anywhere in `index.d.ts` (grep-verified empty). Repro + fix (expose a read method).
- **#2 (opportunistic, D6):** any SDK friction hit while wiring MCP/cross-tenant — only if cleanly reproducible. The offline verifier doubles as the repro harness.

## Risks (named, with mitigations)
- **scan ordering unproven** → Step 0 proves it / sort-in-Rust fallback.
- **cross-anchor regressing to "0-credit broken"** → always invoke from a funded caller; D4 asserts the ~1-credit charge.
- **beta-reuse DQ** → mandatory clean-room reframe + PROVENANCE note naming the lineage first (you sign off).
- **building the floor on set-claims-digest** → floor never depends on it; it's first in the cut order.
- **front-half slippage** → D4 fallback cut; D9 one-day buffer.
- **accounts drifting below 10k** → ~1 credit/call, both start at 20k; D8 checks `getUsage`.

## What I need from you (only you can do these)
1. **Account placement / 3rd identity (optional):** cross-anchor is satisfied by Account 2 + 3. A separate funded examiner or a 3rd anchor would need you to claim+fund it — not required.
2. **`ANTHROPIC_API_KEY` placement** for the MCP proxy (D6) so the proxy can read it but the agent can't.
3. **Sign off** the clean-room name (`z:on-the-record`) + the PROVENANCE note wording before submit (you own the DQ call).
4. **Do the DoraHacks submission** on Jun 21; capture confirmation.
5. *(Optional)* real egress endpoint for `file()` — else it emits a local artifact.

## The honest guarantee
By **D5** this is not a better entry in an existing category — it's a complete, released, running instance of a **new** one: a receipt runtime where acting and producing tamper-evident evidence are one atomic transaction, dual-tenant cross-anchored, **reproducible offline from the shipped artifacts alone** (CHAIN OK + CROSS-ANCHOR OK, network off). The guarantee is that the floor is **whole and self-evident from what ships** — not a probability of winning.

## Immediate next step
**Run Step 0 (scan-ordering test) alongside the probe re-run**, then write the salted `prev_hash` chaining. That settles the one assumption the whole spine rests on before a line of spine code is built on top of it.
