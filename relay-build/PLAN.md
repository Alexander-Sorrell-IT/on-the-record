# Build Plan — Baton-Relay Verification Mesh (D1–D4 → ship 2026-06-22)

**Design:** BATON RELAY (mutual-seal). A live, randomly-routed, cross-tenant verification mesh over the
**already-deployed** `on-the-record` contract. **No new WASM, no re-register.** Each hop: the receiving
node reads the predecessor's unforgeable `did:t3n` inside its TEE (cross-tenant `record-action`),
independently re-fetches its `head()`, and **mutually seals** (each node seals the other's head). Next
hop is pinned by the SHA-256 tail of the just-written row (committed, recomputable random walk).

**Accounts (callers, ~26.8k total):** acct1 4,629 · acct2 9,914 · acct3 12,290. Hosts (contract
deployed): acct2 (107,110), acct3 (111). acct1 ships as a 3rd *paying caller* (no contract needed).
**Cross-tenant invoke confirmed from all 3 — no 10k floor (2026-06-18).**

**Total credit budget: < 3,000cr** (demo + debug + adversarial). The only ~2k op (re-register) is **never done.**

**Key files:** `relay-build/relay.mjs` (new; adapted from `terminal3-agent-mesh/xtenant-probe.mjs`),
contract `terminal3-agent-mesh/contracts/on-the-record/src/lib.rs` (unchanged), verifier
`on-the-record/verifier.mjs` (unchanged). Export rename `{salt,events}→{salt,rows}` per `proxy/custody.mjs:106`.

---

## D1 (Thu 6/18 PM → 6/19) — wiring + ONE green mutual hop
**Goal:** a single A→B mutual baton hop works end-to-end on testnet, and its exports verify offline.

**Tasks**
1. `relay.mjs` from `xtenant-probe.mjs`: connect all 3 keys (handshake/authenticate/getUsage); helpers
   `recordAction(host, action)`, `head(host)`, `sealPeer(host, peerDid, peerHead)`, `getAudit(host)` —
   each via `executeAndDecode` (own-tenant or cross-tenant).
2. One-time owner setup per host (acct2, acct3): **grant** each relay-peer DID on the host policy (so a
   cross-tenant `record-action` is *allowed*, not a DENY row) + **list the judge/user DID as auditor**
   (control-plane map writes, same shape as `proxy/custody.mjs`).
3. Self-test each account: own `record-action` + `head` + `seal-peer` succeed.
4. Hand-drive A→B (serialized): HOP1 A self-records `relay:start`; HOP2 A pins `B.head`; HOP3 A seals B;
   HOP4 A→B cross-tenant `record-action` (B's enclave echoes `calling_user_did()==A`); HOP5 B re-fetches
   `A.head` + confirms; HOP6 B mutually seals A.
5. Export A & B chains (events→rows rename); run the verifier.

**✅ VERIFY (gate):** B's response shows `calling_user_did()==A` · A's chain seals B's head AND B's seals
A's · `verifier.mjs A.json`→CHAIN OK · `verifier.mjs B.json`→CHAIN OK · `verifier.mjs --cross A B`→
**CROSS-ANCHOR OK** (mutual-seal payoff; would be WEAK one-way) · credits caller-pays (A: HOP1-4, B: HOP5-6).
**Credits:** ~500cr (hop ~166 + grants ~300).

## D2 (6/20) — randomized loop + full route + reject beat
**Goal:** full A→B→C→answer randomized loop; all chains CHAIN OK + pairwise CROSS-ANCHOR OK; head-mismatch reject works.

**Tasks**
1. `pickNextPeer(myFreshHead)` = `parseInt(myHead.slice(-8),16) % candidates`, candidates = funded accts − self − immediate predecessor. (Committed, recomputable; print the number.)
2. Loop the mutual-seal hop A→B→C→…→final, **serialized** (await each hop — never two callers on the same trail in one unconfirmed window → avoids same-`prev_hash` fork→BROKEN).
3. Final holder records `relay:answer` (own chain) + returns `{result, per-hop heads, seal seqs}`.
4. Reject path: if a node's re-fetched predecessor head ≠ the claimed head → write `relay:reject`, halt.

**✅ VERIFY (gate):** full route completes; next-peer pick = the committed hash (recomputable) · all 3
chains CHAIN OK · `--cross A B` and `--cross B C` → CROSS-ANCHOR OK · tampering a claimed head → `relay:reject` + halt.
**Credits:** ~900cr (route ~373 + debug).

## D3 (6/21) — adversarial beats + tamper proof + record the demo
**Goal:** refusal/tamper/cold-walk beats verify; the narrated mesh demo is recorded.

**Tasks**
1. **DENY beat:** owner-revoke a relay peer's grant on a host → next inbound hop records `denied`
   (refusal-as-receipt) + baton halts. Verify the denied row + halt.
2. **TAMPER/FORGE beat:** hand-edit an exported row / forge a seal's `peer_head` → re-run verifier →
   BROKEN AT seq / CROSS-ANCHOR MISMATCH.
3. **COLD RE-WALK:** from downloaded chains only, per-chain CHAIN OK + pairwise `--cross` OK → reconstruct the route, zero re-execution.
4. **Narration (mesh A-story):** rewrite the script to the mesh/authority lead (receipts = proof
   byproduct; distinctness vs RoboTruth) → re-render in the **cloned voice** (existing `voice_kit` NeuTTS
   pipeline, ~70 min) → assemble. Then **record the demo** (live baton + enclave identity echo + adversarial beats + cold re-walk).

**✅ VERIFY (gate):** denied-on-revoke verified · tamper→MISMATCH verified · cold re-walk reproduces the
route with no network/SDK · demo recorded with the mesh narration in your voice.
**Credits:** ~500cr (adversarial + debug). VO re-render = local, 0cr.

## D4 (6/22) — reframe docs + submit + buffer
**Goal:** docs reframed to the mesh A-story, config-ized, pushed; BUIDL ready; buffer absorbs slips.

**Tasks**
1. Reframe README / SUBMISSION / DORAHACKS-FIELDS to the **mesh A-story** (lead: live trust topology +
   the cross-tenant **platform finding**; receipts demoted to proof). Make the cross-tenant-no-10k-floor finding a **headline**, not a footnote.
2. Config-ize `relay.mjs` (tenant ids/dids in a config — nothing hardcoded).
3. Final credit-balance check; commit + push (mesh code + reframed docs + exports + demo).
4. Upload the video (YouTube unlisted) → paste into the BUIDL. File the Track-2 reports (the cross-tenant finding first).
5. **Buffer** for any slip.

**✅ VERIFY (gate):** fresh-clone cold re-walk green · docs lead with the mesh + the finding · pushed · BUIDL submittable.

---

## Fallback ladder (no deadline risk)
1. Flaky random C-hop → ship a **fixed 2-node mutual baton** (A→B→A): headline property (live in-path
   verify + mutual cross-anchor OK + tamper→MISMATCH) fully shown with 2 nodes; narrate random selection honestly as the scale property.
2. Unstable live demo → pre-recorded D3 capture + a **static evidence bundle** (3 exported chains) the
   judge re-walks with `verifier.mjs` (OK) + a tampered copy (MISMATCH) — needs no network/SDK.
3. Hard fallback → the **finished, already-pushed single/2-tenant On-the-Record** stands. Because there
   is **zero contract change / zero re-register**, no broken build can damage the existing deployment — worst case is simply fewer hops.

## Honest scope (narrate exactly this)
With 3 same-owner accounts the per-hop candidate set is tiny, so this demonstrates the **mechanism** of
committed, recomputable, non-retro-rollable selection — **not** statistical non-collusion among
independent owners. Sell the live in-path gate + the topology that scales to that at large N; **never** "a jury of strangers."
