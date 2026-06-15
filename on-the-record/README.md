# On the Record — THE RECEIPT

> An agent runtime where **acting** and **producing tamper-evident evidence of
> the act** are *one atomic in-enclave transaction*. There is no separate
> logging step that can drift, lie, or be skipped: the receipt **is** the
> action. Everything else in this entry — the offline verifier, the
> cross-anchor, the audit reads — derives from that one substrate.

This is the canonical entry document. It is deliberately honest and concrete:
every claim below points at a real artifact you can open, re-run, or break.

---

## 1. What it is

Most "audit logs" are written *after* the fact by the same component that took
the action — so a component that misbehaves can also rewrite its own story.
"On the Record" removes that gap.

A caller invokes a single governed verb, `record-action`. Inside the enclave,
in one transaction, the contract:

1. reads the caller's identity **from the host** (`calling_user_did`), never
   from the request body;
2. evaluates the grant policy for that caller (`allowed` / `denied`);
3. touches any secret **only inside the enclave** and returns a masked proof —
   the raw secret never crosses the WIT boundary;
4. appends the decision as a **salted hash-chained row** to a contract-only
   trail.

The decision and its evidence are the same write. A refusal is *also* a
receipt: a denied call appends a `denied` row chained onto the prior row, so
"the agent refused" is itself permanent, ordered evidence — not an absence of a
log line.

**The substrate is the receipt.** Every other capability is derived from it:

- **Tamper-evidence** comes from the hash chain over receipts.
- **Cross-anchoring** is just *another receipt* — a `seal` row whose action is
  `{"type":"seal","peer_did":...,"peer_head":...}`, chained through the exact
  same hash path as any other row.
- **Offline verification** is recomputing those receipt hashes with nothing but
  a public salt and SHA-256.

### Dual-tenant cross-anchor

A single tenant can be coerced. So two **independently-claimed** tenants each
seal the *other's* real chain head into their own chain. Because each chain's
head is anchored inside the peer's chain, **a single tenant cannot rewrite its
history without also forging the peer's chain — which independently anchors it.**
On the real shipped testnet exports this binds in **both** directions
(`CROSS-ANCHOR OK`): forging the record requires corrupting two
separately-claimed tenants at once, not one. (The two anchors are accounts we
control, so this proves the *mechanism*; full independence is when third parties
run the anchors — see "Honest limits".)

### The hash rule (one rule, used everywhere)

```
hash = hex( SHA256( utf8(salt) ‖ hexdecode(prev_hash) ‖ canonical_json(record_without_hash) ) )
genesis prev_hash = 64 zeros
salt = public per-tenant string  "on-the-record:v1:<tenant_id>"
```

`canonical_json` is deterministic sorted-key serialization. The salt is a
**public** per-tenant domain-separation string (it is shipped verbatim in every
export); it is *not* a secret. Each row is:

```
{ seq, ts, caller_did, action, outcome('allowed'|'denied'), masked_secret, reason, prev_hash, hash }
```

The contract source is at
[`terminal3-agent-mesh/contracts/on-the-record`](../terminal3-agent-mesh/contracts/on-the-record)
(Rust → wasm). Verbs: `record-action` (grant-checked, emits an `allowed` or
`denied` chained row), `revoke(target_did)` (owner-only), `get-audit`
(owner-or-auditors), `head()` (returns the chain tail hash, appends nothing),
`seal-peer(peer_did, peer_head)` (chained seal row), `reset` (owner-only).

---

## 2. Proven on testnet

These are real, registered, on-chain artifacts — not mockups. (We do **not**
re-run testnet here; the rows below already exist on the Terminal 3 testnet and
are captured verbatim in the exports in this directory.)

| Registration | Contract id | Account |
|---|---|---|
| Refusal demo (allowed → revoke → denied) | **107** | Account 2 |
| Cross-anchor, tenant A | **110** | Account 2 |
| Cross-anchor, tenant B | **111** | Account 3 |

### The refusal chain (acting and refusing are both receipts)

Captured in [`export.json`](export.json):

- **ALLOWED** — `seq 29263`, action `transfer:invoice-7782`, `outcome:
  allowed`, masked secret `sk_l…****…2a7c`, `prev_hash` = 64 zeros (genesis),
  `hash 7ab05ec0…b9a0`.
- The grant is then revoked (`revoke(target_did)`, owner-only).
- **DENIED-after-revoke** — `seq 29270`, action `transfer:invoice-7783`,
  `outcome: denied`, `reason: no_active_grant`, **`prev_hash 7ab05ec0…b9a0`**
  (it chains directly onto the allowed row), `hash 22eef927…d61a`.

The refusal is cryptographically linked to the action that preceded it. You
cannot keep the convenient `allowed` row and quietly drop the inconvenient
`denied` one: removing or editing either row breaks the chain at that seq.

### The cross-anchor (neither tenant can rewrite its history alone)

Captured in [`export-a2.json`](export-a2.json) (Account 2, 2 rows) and
[`export-a3.json`](export-a3.json) (Account 3, 1 row):

- **A2** — `seq 29401`, `hash 00929429…e07a` (its first row), then `seq 35984`,
  `hash 4e9ebc4e…0619` (its current head). A2's seal row anchors A3's **real
  head `c4acbe4985ffbf61b47698fe56171d01eb2fcea3770b540104c23a7341268411`**.
- **A3 seal** — `seq 29406`, `hash c4acbe49…8411`. A3's seal row anchors A2's
  **real head `0092942958fec2bfea808bd2d63804b1977f35212ac70eae5b724d32bd9de07a`**
  (A2's first-row hash, which still exists in A2's chain).

Each tenant binds the **other's real head**, so the cross-anchor is
`CROSS-ANCHOR OK` in both directions. A2 cannot rewrite its history without
changing the head A3 sealed, and A3 cannot rewrite its history without changing
the head A2 sealed — so neither can rewrite alone without breaking the peer's
anchor. The two chains pin each other. (The offline verifier enforces exactly
this; see the negative tests below.)

---

## 3. Reproduce offline in 30 seconds (the floor)

This is the floor of the whole entry: **no credits, no network, no SDK.** Pure
Node, built-in `crypto` only. Run it from the repo root.

```bash
# 1) The refusal chain verifies end-to-end:
node on-the-record/verifier.mjs on-the-record/export.json
#    -> CHAIN OK 2 rows

# 2) The two tenants genuinely anchor each other (both directions bind real heads):
node on-the-record/verifier.mjs --cross on-the-record/export-a2.json on-the-record/export-a3.json
#    -> CROSS-ANCHOR OK (A head=4e9e…0619 bound in B; B head=c4ac…8411 bound in A)

# 3) Tamper — flip one byte in any row of export.json (don't recompute its hash):
node on-the-record/verifier.mjs on-the-record/export.json
#    -> BROKEN AT seq=<the row you touched>

# 4) The verifier's own test suite (8 checks: 3 positive + 2 negative + structure):
node on-the-record/verifier.test.mjs
#    -> ALL TESTS PASSED
```

The verifier ([`verifier.mjs`](verifier.mjs)) recomputes every receipt hash
from the public salt and reports `CHAIN OK <n> rows` or the exact `seq` where
continuity breaks. In `--cross` mode it asserts each chain verifies *and* that
each tenant's seal anchors a head the peer genuinely exposed — so a forged head
(neither the peer's final head nor its pre-seal-back head) is rejected with
`CROSS-ANCHOR MISMATCH`. The tests ([`verifier.test.mjs`](verifier.test.mjs))
include two negative cases: forging a tenant's head row, and rewriting a
tenant's body so its head no longer matches what the peer sealed — both must
fail, and do.

---

## 4. SDK integration depth

The receipt substrate is wired through real SDK surfaces, end to end. The
following are actually exercised by this entry (not aspirational):

- **`contracts.register`** — both the single-tenant refusal contract (id 107)
  and the two cross-anchor tenants (ids 110 / 111) are registered through the
  SDK registration path.
- **Cross-tenant `executeAndDecode`** — the seal transport: tenant A reads B's
  `head()` and submits `seal-peer(...)`, and symmetrically, over the proven
  client execute/decode path. The cross-anchor rides existing transport; it is
  not a side channel.
- **Contract-scoped map ACLs** — the audit trail is a contract-only map; reads
  are gated to the owner / designated auditors.
- **`executeControl` control-plane seeding** — grants are seeded via the
  control plane, then enforced in-enclave; `revoke` flips the grant so the next
  call produces the `denied` receipt shown above.
- **In-enclave host context** — `calling_user_did()` (unforgeable caller
  identity), `seq_no()` (host-stamped ordering used as the row key),
  `cluster_timestamp_secs()` (host-stamped time), `kv_store` (per-tenant
  namespaced record storage), and masked secrets (read in-enclave, only `mask()`
  output crosses the boundary).
- **`did:t3n` ETH auth** — callers and tenant owners are `did:t3n:<hex>`
  identities; the contract derives identity from the host, not the body.
- **`get-audit` reads** — owner/auditor-scoped export of the chain (including
  its public salt) so the trail can be pulled and then verified entirely
  offline.

---

## 5. Honest limits

We state these plainly because the entry is named "On the Record."

- **Tamper-EVIDENT, not tamper-PROOF.** The chain does not *prevent*
  modification; it makes any modification *detectable*. An adversary with full
  write access can still delete or rewrite rows — any such edit is caught by the
  verifier (`BROKEN AT` or `CROSS-ANCHOR MISMATCH`). The guarantee is detection,
  not prevention.
- **Cross-anchor binds each tenant's history up to the last mutual seal.** On
  the shipped testnet pair the binding holds in **both** directions
  (`CROSS-ANCHOR OK`): each tenant seals the other's real head, so neither can
  rewrite alone. Rows appended *after* the peer's most recent seal are not yet
  pinned by that seal — re-sealing the new head closes the window, exactly as the
  shipped pair did to reach mutual OK.
- **Cross-anchor is demonstrated with two accounts we control.** What is proven
  on testnet is the *mechanism*: two separately-claimed tenants pinning each
  other's heads such that neither can rewrite alone. It is **not** yet a claim
  of independent-operator trust — that holds fully only when third parties run
  the peer anchors. We control both accounts in this demo and say so.
- **No "cluster-signed" claim is made.** We deliberately do **not** assert that
  receipts carry a cluster signature, because the SDK read path for that
  attestation is absent from what we could exercise. Stating it would be
  guessing. This gap is filed as Track-2 #1 — see
  [`../track2-report-01-claims-digest.md`](../track2-report-01-claims-digest.md).
- **No percentages.** The guarantee is framed as **category + completion**
  (what kind of property it is, and that it is actually built and verifiable),
  never as a confidence percentage.

---

## 6. MCP custody proxy + keyless agent loop

The receipt substrate above answers *"can the record be trusted?"*. This piece
answers a second question: *"can the agent that produces the record be trusted
not to hold the key?"* — and proves it by construction.

- **The agent holds NO key.** [`agent-loop.mjs`](agent-loop.mjs) scrubs every
  `T3N_API_KEY*` / `T3N_KEY` from its own `process.env` and **asserts none
  remain** before doing anything. In the captured run there was nothing left to
  scrub because the keys were never handed to the agent at all (we launch it with
  the keys unset). It also runs with **no model API key**: its brain is the local
  `claude` CLI invoked over `spawnSync` (same pattern as
  [`terminal3-agent-mesh/src/agent-buyer.ts`](../terminal3-agent-mesh/src/agent-buyer.ts)).
- **The proxy holds the key, alone.** [`proxy/mcp-server.mjs`](proxy/mcp-server.mjs)
  is a **real MCP stdio server** (`@modelcontextprotocol/sdk` v1.29.0). It sources
  Account 3's key from the project `.env` on its OWN side, hands it once to
  [`proxy/custody.mjs`](proxy/custody.mjs) (a closure — there is deliberately **no
  method that returns the key**), and exposes only the recorded verbs `act` /
  `head` / `verify` / `file`. No tool input field is key-shaped; the agent asserts
  this from the live tool schema (`key_never_in_tool_schema: true`).
- **The proxy is the agent's ONLY path to the chain.** A negative check confirms
  it: with no key in env, the agent cannot even construct a signer
  (`custody: no T3N key provided`). It reaches the ledger exclusively by calling
  the proxy's `act()` tool.

### The run (credit-safe, captured in [`export-agent.json`](export-agent.json))

The keyless brain ran a short gather → decide → act loop. Each turn it read the
current chain head, the `claude` CLI chose one compliance action, and the proxy's
`act()` appended exactly one new chained row whose `prev_hash` equals the head the
agent had just observed:

| seq | action | outcome | chains onto head |
|---|---|---|---|
| 29680 | `load-policy` | allowed | yes |
| 29686 | `process-batch:invoices` | allowed | yes |
| 29692 | `flag-anomaly:txn-4471` | allowed | yes |

Then `verify()` over the live trail and the offline `verifier.mjs` over the export
both report **CHAIN OK 5 rows** (the two pre-existing rows — Account 3's seal seq
29406 and the proxy proof act seq 29652 — plus the three new agent acts). Account 3
finished at **13,592 credits**, above the 10,000 floor. Account 2 is never used.

```bash
# keyless: run with the T3N keys (and the model key) unset — the proxy self-sources.
env -u T3N_API_KEY -u T3N_API_KEY_2 -u T3N_API_KEY_3 -u T3N_KEY -u ANTHROPIC_API_KEY \
  node on-the-record/agent-loop.mjs
#  -> ==== AGENT-LOOP RESULT ==== (a JSON object), including:
#       "acts_through_proxy": 3, "verifier_cli": "CHAIN OK 5 rows", "agent_holds_no_key": true
```

**Transport achieved (honest note):** tier 1 / BEST — a genuine MCP stdio server
and a genuine MCP `Client` (not a mock or an in-process shim). The proxy is proven
twice: by [`proxy/prove.mjs`](proxy/prove.mjs) (a single scripted act) and by the
keyless `claude`-CLI agent loop here (three autonomous acts). The one piece that is
not over MCP is the credit-floor read and the export write — both are done by the
**custody side** (`proxy/usage-probe.mjs` and the proxy's `--emit-export` flag),
precisely so the agent never gains a key or a read path of its own.

---

## 7. Provenance

This entry is a clean-room reframe of an earlier contract by the same author
(`mesh-seller`) into a general receipt runtime. The inherited in-enclave
chassis and the genuinely new parts (salted hash-chain, generalized verb,
offline verifier, dual-tenant cross-anchor) are disclosed in full, up front, in
[`../PROVENANCE.md`](../PROVENANCE.md).

---

### Files in this directory

| File | What it is |
|---|---|
| [`verifier.mjs`](verifier.mjs) | Offline verifier. Pure Node, zero SDK, zero network. |
| [`verifier.test.mjs`](verifier.test.mjs) | 8 checks: positive chain, byte-flip, cross-anchor positive + 2 negatives. |
| [`export.json`](export.json) | Refusal chain: ALLOWED (seq 29263) + DENIED-after-revoke (seq 29270). |
| [`export-a2.json`](export-a2.json) | Cross-anchor tenant A (Account 2, 2 rows; head seq 35984 seals A3's real head). |
| [`export-a3.json`](export-a3.json) | Cross-anchor tenant B (Account 3, seal seq 29406 seals A2's real head). |
| [`proxy/mcp-server.mjs`](proxy/mcp-server.mjs) | MCP stdio custody proxy. Holds the key (self-sourced from `.env`); exposes `act/head/verify/file`. |
| [`proxy/custody.mjs`](proxy/custody.mjs) | The only module that touches the key; closure-private, no key getter. |
| [`agent-loop.mjs`](agent-loop.mjs) | Keyless agent: brain = `claude` CLI, hands = MCP proxy. Asserts no T3N key in its env. |
| [`export-agent.json`](export-agent.json) | The keyless-agent run: 5 rows (CHAIN OK), 3 of them produced through the proxy. |
