# On the Record — a no-single-point-of-trust agent mesh

> A live trust **topology** for multi-agent action. As a task is relayed
> agent→agent, the receiving agent reads the sender's **unforgeable `did:t3n`**
> inside its own Terminal 3 enclave, independently re-checks the sender's chain
> head, and **mutually cross-anchors** it *before* the work advances. The next
> verifier is a **random draw pinned by the chain hash** — recomputable by
> anyone, steerable by no one. Every node both verifies and is verified, and
> anyone can re-walk the entire route offline. Verification lives in the **live
> control path**, not in an after-the-fact audit log.

This is the canonical entry document. It is deliberately honest and concrete:
every claim below points at a real artifact you can open, re-run, or break — on
the Terminal 3 testnet and entirely offline.

---

## 1. What it is

Agents are starting to act *through* each other — one agent handing a task to
the next. The danger isn't only that you can't audit an agent after the fact;
it's that **at the moment of action there is no one trustworthy to vouch for
it.** You can't trust a single agent, and you can't trust a single *fixed*
validator either — it can be bribed, or it simply goes down.

What's missing is a **topology**: a way for agents to verify each *other*, with
no single point of trust, and to prove afterward that they did — without anyone
re-running anything.

On the Record is that topology. A task enters at one node and is relayed
node→node. At every hop the **receiving** node must, inside its own enclave:

1. accept a cross-tenant call whose caller identity is stamped by the **host**
   (`calling_user_did()`), not by the request body — so the sender's `did:t3n`
   is **unforgeable**;
2. independently re-fetch the sender's chain `head()` and confirm it matches the
   head the sender announced;
3. **mutually seal** — each node writes a `seal` row anchoring the *other's*
   real head, so the pair binds in both directions (`CROSS-ANCHOR OK`).

Only then does the baton advance. The next hop is chosen by a **committed random
draw** off the chain itself (`parseInt(myHead.slice(-8),16) % candidates`) —
any verifier can recompute it, and no node can steer who checks it next. There
is no privileged auditor and no fixed validator: **every node both verifies and
is verified.**

The mesh rides entirely on the **already-deployed `on-the-record` contract** —
**no new WASM, no re-register.** The receipts it leaves behind are the proof
layer (below): the byproduct of routing, not the product.

---

## 2. How one hop works (the mutual baton)

A single hop `prev → next` is six in-enclave/cross-tenant steps
([`relay-build/relay.mjs`](../relay-build/relay.mjs), `mutualHop`):

1. `prev` reads `next.head()` (cross-tenant read, appends nothing).
2. `prev` writes a `seal` row anchoring `next`'s head (owner write).
3. `prev` invokes `record-action` **on `next`'s contract** — `next`'s enclave
   stamps the **unforgeable `calling_user_did()`**, which equals `prev`'s
   `did:t3n`. The sender cannot fake who it is; the host attests it.
4. `next` independently re-reads `prev.head()` and confirms it equals the head
   `prev` announced in the hop row (`ah=…`). On mismatch, `next` writes
   `relay:reject` and the baton halts.
5. `next` writes a `seal` row anchoring `prev`'s real head — the **mutual**
   half. Now both chains pin each other → `CROSS-ANCHOR OK`.
6. `next` becomes the holder; the committed random draw picks the next peer.

### The hash rule (one rule, used everywhere)

```
hash = hex( SHA256( utf8(salt) ‖ hexdecode(prev_hash) ‖ canonical_json(record_without_hash) ) )
genesis prev_hash = 64 zeros
salt = public per-tenant string  "on-the-record:v1:<tenant_id>"
```

`canonical_json` is deterministic sorted-key serialization. The salt is
**public** (shipped verbatim in every export); it is domain separation, not a
secret. A `seal` is just another row whose action is
`{"type":"seal","peer_did":…,"peer_head":…}`, chained through the exact same
hash path — so cross-anchoring needs no special machinery, only one more
receipt.

---

## 3. Proven on testnet (the live relay)

Real, on-chain artifacts — not mockups. Three independently-claimed tenants act
as the three nodes:

| Node | `did:t3n` (tenant) | role |
|---|---|---|
| **A** | `3f6988bd4faa2548af798e9f1004b57f8fa1fe19` | entry / holder |
| **B** | `01882ebbf599fcbfc9c6cc562ea4ce7d93135773` | hop 1 |
| **C** | `1b38f2d98ff6d0eddc9ceb0a14d3987544db7577` | hop 2 / answer |

The committed random walk produced the route **A → B → C → answer**. The
relevant rows (captured verbatim in
[`relay-build/export-A.json`](../relay-build/export-A.json) /
[`-B`](../relay-build/export-B.json) / [`-C`](../relay-build/export-C.json)):

| chain | seq | row | what it proves |
|---|---|---|---|
| A | 45198 | `relay:start u=demo task=t1` | task enters at A |
| A | 45204 | `seal peer=B` | A anchors B's head |
| **B** | **45209** | `relay:hop from=A ah=add886d…` | **B's enclave stamped `caller_did = A`** (and `ah` = A's real head `add886d4…0166`) |
| B | 45214 | `seal peer=A` | B anchors A's head → **A↔B mutual** |
| B | 45221 | `seal peer=C` | B anchors C's head |
| **C** | **45225** | `relay:hop from=B ah=2760ea5…` | **C's enclave stamped `caller_did = B`** (and `ah` = B's real head `2760ea5e…5489`) |
| C | 45229 | `seal peer=B` | C anchors B's head → **B↔C mutual** |
| C | 45233 | `relay:answer result=done` | answer produced at C |

Final heads: A `add886d4…0166` · B `2760ea5e…5489` · C `5431cce1…35f5`.

The two unforgeable caller stamps are the heart of it: **no node took its
predecessor on faith** — the host told it who called. The offline verifier
(below) grades both traversed pairs `CROSS-ANCHOR OK`.

---

## 4. The adversarial beats (it actually refuses / breaks)

From [`relay-build/adversarial.mjs`](../relay-build/adversarial.mjs):

- **Tamper → BROKEN.** Flip one byte in any row of an export without recomputing
  its hash → the verifier reports `BROKEN AT seq=<row>`. You cannot keep the
  convenient rows and quietly edit one.
- **Authority in the path → DENIED.** A live testnet demonstration
  (`adversarial.mjs` BEAT 3): owner-revoke a peer's grant on a host
  (`executeControl` map-entry-set `grant:<did>=revoked`), and the peer's very
  next in-path `record-action` returns `outcome=denied reason=no_active_grant` —
  the refusal is itself a chained receipt, so an agent **cannot act off the
  record**. (Printed live by the script; not persisted in the shipped exports.)
- **Forge a vouch → not OK.** The pair A–C was never mutually sealed (the route
  was A→B→C), so `--cross A C` grades `CROSS-ANCHOR WEAK`, not OK; a fabricated
  `peer_head` that the peer never exposed grades `CROSS-ANCHOR MISMATCH`.

---

## 5. Platform finding — cross-tenant invoke is not 10k-gated

A reusable result for the whole Terminal 3 ecosystem. The platform's only
credit error is `403 InsufficientCredit (required=10000)`, seen on **0-credit /
unclaimed** identities — so it is natural to assume *every* paid operation,
invoke included, needs ≥10,000 credits held. **For cross-tenant invoke it does
not.** A caller holding just **1,203 credits** makes a *paid* cross-tenant
`record-action` the host enclave accepts: `outcome=allowed`, the caller's
`did:t3n` stamped in-enclave, ~151 credits charged. Reproduce it live (captured
run in [`relay-build/subfloor-evidence.txt`](../relay-build/subfloor-evidence.txt)):

```bash
node --env-file=.env relay-build/probe_subfloor.mjs
#  -> VERDICT: NO 10k FLOOR — a 1203-credit account made a PAID cross-tenant invoke (allowed, paid 151cr)
```

This is what makes the mesh buildable today on ordinary funded accounts instead
of only on 10k-funded ones.

---

## 6. Reproduce offline in 30 seconds (the floor)

The floor of the whole entry: **no credits, no network, no SDK.** Pure Node,
built-in `crypto` only. Run from the repo root.

```bash
# 1) Each node's chain verifies end-to-end:
node on-the-record/verifier.mjs relay-build/export-A.json   # -> CHAIN OK 17 rows
node on-the-record/verifier.mjs relay-build/export-B.json   # -> CHAIN OK 9 rows
node on-the-record/verifier.mjs relay-build/export-C.json   # -> CHAIN OK 4 rows

# 2) The traversed pairs genuinely anchor each other (both directions):
node on-the-record/verifier.mjs --cross relay-build/export-A.json relay-build/export-B.json  # -> CROSS-ANCHOR OK
node on-the-record/verifier.mjs --cross relay-build/export-B.json relay-build/export-C.json  # -> CROSS-ANCHOR OK
# A and C were never sealed (route was A->B->C), so this is honestly WEAK, not OK:
node on-the-record/verifier.mjs --cross relay-build/export-A.json relay-build/export-C.json  # -> CROSS-ANCHOR WEAK

# 3) Tamper — flip one byte in a row WITHOUT recomputing its hash, then verify:
cp relay-build/export-A.json /tmp/tamper.json
node -e 'const f="/tmp/tamper.json",o=JSON.parse(require("fs").readFileSync(f));o.rows[5].action="X"+o.rows[5].action.slice(1);require("fs").writeFileSync(f,JSON.stringify(o))'
node on-the-record/verifier.mjs /tmp/tamper.json            # -> BROKEN AT seq=<that row>

# 4) The verifier's own suite (36 checks: chains, byte-flip tamper,
#    cross-anchor OK/WEAK/MISMATCH, forgery/shadow-seal/rewrite/broken-peer, authority logic):
node on-the-record/verifier.test.mjs                        # -> ALL TESTS PASSED
```

The verifier ([`verifier.mjs`](verifier.mjs)) recomputes every receipt hash from
the public salt and reports `CHAIN OK <n> rows` or the exact `seq` where
continuity breaks. In `--cross` mode it asserts each chain verifies *and* that
each tenant's seal anchors a head the peer genuinely exposed — so a forged head
is rejected (`MISMATCH`), and a one-way binding is graded `WEAK`, never OK.

---

## 7. SDK integration depth

The mesh is wired through real SDK surfaces, end to end (actually exercised, not
aspirational):

- **Cross-tenant `executeAndDecode`** — the relay transport itself. Each hop is
  one node invoking the *next* node's contract over the proven execute/decode
  path; the caller pays. This is the mechanism, not a side channel.
- **In-enclave `calling_user_did()`** — the unforgeable per-hop identity gate.
  The receiving enclave stamps the true caller; the sender cannot spoof it.
- **`seal-peer` + `head()`** — the mutual cross-anchor. `head()` appends nothing;
  `seal-peer` writes the chained anchor row.
- **`executeControl` control-plane** — grants are seeded and **revoked** through
  the control plane, then enforced in-enclave (the DENIED beat).
- **Contract-scoped map ACLs** — `policy` / `secrets` / `trail` maps are scoped
  to the contract id (the required setup for a fresh tenant to join the mesh).
- **`contracts.register`** — nodes register the `on-the-record` contract; the
  mesh adds **zero** new WASM.
- **In-enclave host context** — `seq_no()` (host-stamped ordering / row key),
  `cluster_timestamp_secs()` (host-stamped time), `kv_store`, masked secrets
  (read in-enclave; only `mask()` output crosses the WIT boundary).
- **`did:t3n` ETH auth** — every node and caller is a `did:t3n:<hex>` identity.
- **`get-audit` reads** — owner/auditor-scoped export (incl. the public salt) so
  any chain can be pulled and verified entirely offline.

---

## 8. The receipt substrate (the proof layer)

The mesh is the story; the **receipt** is how it proves itself. Acting and
producing tamper-evident evidence are *one atomic in-enclave write*: there is no
separate logging step that can drift, lie, or be skipped. A refusal is *also* a
receipt (the DENIED row chains onto the prior row), so "the agent refused" is
permanent, ordered evidence — not an absence of a log line. The same substrate
also carries a **keyless agent** demonstration: in
[`agent-loop.mjs`](agent-loop.mjs) the agent holds **no key** (it asserts every
`T3N_API_KEY*` is scrubbed from its env) and reaches the chain only through a
real MCP stdio custody proxy ([`proxy/mcp-server.mjs`](proxy/mcp-server.mjs),
`@modelcontextprotocol/sdk`) — it literally cannot act off the record.

Contract verbs ([`contracts/on-the-record`](../contracts/on-the-record),
Rust → wasm): `record-action` (grant-checked; emits an `allowed`/`denied`
chained row), `head()` (returns the chain tail, appends nothing),
`seal-peer(peer_did, peer_head)` (chained seal row), `get-audit`
(owner-or-auditors), `revoke(target_did)` / `reset` (owner-only).

---

## 9. Honest limits

Stated plainly, because the entry is named "On the Record."

- **Three same-owner accounts demonstrate the *mechanism*, not non-collusion.**
  With a tiny candidate set the committed random draw shows it is recomputable
  and non-retro-rollable — the property that scales to **statistical
  non-collusion at large N with independent owners.** We do **not** claim "a jury
  of strangers"; we control all three accounts and say so.
- **Tamper-EVIDENT, not tamper-PROOF.** The chain does not *prevent*
  modification; it makes any modification *detectable* (`BROKEN AT` /
  `MISMATCH`). The guarantee is detection, not prevention.
- **Cross-anchor binds each pair up to its last mutual seal.** Rows appended
  *after* the peer's most recent seal aren't yet pinned; re-sealing closes the
  window (exactly as the shipped pairs did to reach mutual OK).
- **No "cluster-signed" claim.** We do not assert receipts carry a cluster
  signature — the SDK read path for that attestation is absent from what we could
  exercise. Filed as Track-2 (see
  [`../track2-report-01-claims-digest.md`](../track2-report-01-claims-digest.md)).
- **No percentages.** The guarantee is framed as **category + completion**, never
  as a confidence number.

---

## 10. Provenance

This entry reframes an earlier in-enclave contract by the same author
(`mesh-seller`) into a general receipt runtime, then builds the verification
mesh on top of it. The inherited chassis and the genuinely new parts (salted
hash-chain, generalized verb, offline verifier, mutual cross-anchor, the relay)
are disclosed in full in [`../PROVENANCE.md`](../PROVENANCE.md).

---

### Files

| File | What it is |
|---|---|
| [`../relay-build/relay.mjs`](../relay-build/relay.mjs) | The mesh: randomized 3-node mutual-baton relay over the deployed contract. |
| [`../relay-build/adversarial.mjs`](../relay-build/adversarial.mjs) | Adversarial beats: tamper→BROKEN, revoke→denied, forge→not-OK. |
| [`../relay-build/export-A.json`](../relay-build/export-A.json) | Node A chain (entry/holder; route A→B→C). |
| [`../relay-build/export-B.json`](../relay-build/export-B.json) | Node B chain (hop 1; `caller=A` stamp at seq 45209). |
| [`../relay-build/export-C.json`](../relay-build/export-C.json) | Node C chain (hop 2 + answer; `caller=B` stamp at seq 45225). |
| [`verifier.mjs`](verifier.mjs) | Offline verifier. Pure Node, zero SDK, zero network. |
| [`verifier.test.mjs`](verifier.test.mjs) | 36 checks (chains, tamper, cross-anchor OK/WEAK/MISMATCH, authority). |
| [`agent-loop.mjs`](agent-loop.mjs) | Keyless agent: brain = `claude` CLI, hands = MCP proxy; asserts no T3N key. |
| [`proxy/mcp-server.mjs`](proxy/mcp-server.mjs) | MCP stdio custody proxy; holds the key, exposes only `act/head/verify/file`. |
