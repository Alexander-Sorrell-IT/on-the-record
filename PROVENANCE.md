# PROVENANCE — "On the Record" (THE RECEIPT)

**Purpose of this note.** This is an honest, up-front disclosure of where this
entry came from. Part of it descends from earlier work by the same author. We
name that lineage here, before review, so the resemblance is on the record
rather than discovered later. Nothing below is offered as an excuse; it is a
plain accounting of what is inherited and what is new.

## The lineage

This contract descends from an earlier contract, **`mesh-seller`**, which the
same author built as the seller side of an agent mesh and used in a prior
**beta-edition** submission. `mesh-seller` was a domain-specific contract: a
buyer agent called `purchase(item, amount_cents, currency)`, the contract
enforced spend caps in-enclave, touched a payment secret, and appended a
decision to an audit map.

"On the Record" is a **clean-room reframe** of that work into a different and
more general thing: a **receipt runtime**. The purchase verb and all of its
buyer/seller/payment framing are gone. In their place is a single general verb,
`record-action` (exposed to the agent through the custody proxy's `act()` tool),
whose contract is that *acting and producing tamper-evident evidence of the act
are one atomic in-enclave transaction*. The package namespace was
moved from `z:mesh-seller` to `z:on-the-record`, and no `purchase` / `item` /
`amount_cents` framing remains in the new surface.

We do not claim the two are unrelated. They share a chassis. We claim the new
work is a genuinely different category built on that chassis, and below we
separate exactly which parts are which.

## What was reused (the in-enclave chassis)

These primitives and patterns are carried over from `mesh-seller` substantially
as-is. They are the part of the prior work that is honestly inherited:

- **Unforgeable caller identity** — caller DID is read from the host via
  `calling_user_did()`, never trusted from the request body.
- **Host-stamped ordering and time** — the host `seq_no()` and
  `cluster_timestamp_secs()`, used to key and timestamp each record.
- **Per-tenant KV namespacing** — `kv_store` maps keyed `z:<tenant>:<map>`,
  with records keyed by `{:020}` zero-padded sequence number.
- **Secret masking** — secrets are read only inside the enclave; only a masked
  proof (`mask()`) ever crosses the WIT boundary back to the caller.
- **Append-on-every-decision auditing** — `audit_write()` and `get_audit()`,
  including the existing pattern that a *refusal also writes a record*
  (refusal-as-evidence), and the owner/auditor authorization on reads.

If a reviewer recognizes any of the above from the beta-edition `mesh-seller`,
that recognition is correct. That is the inherited chassis.

## What is genuinely new (this entry)

None of the following existed in `mesh-seller`. These are the contributions of
"On the Record":

- **Salted hash-chain over the records.** Each row now carries `prev_hash` and
  `hash`, where `hash = SHA256(salt ‖ prev_hash ‖ canonical_json(record))`. The
  prior audit map was append-only but had no cryptographic continuity between
  rows; this makes the log tamper-evident, not merely append-ordered.
- **Generalized `record-action`.** The domain-specific `purchase()` is replaced
  by a single general contract verb, `record-action` (surfaced to the agent as
  the custody proxy's `act()` tool), that takes an action and a policy reference,
  so the runtime records arbitrary governed actions rather than purchases.
- **Offline, network-free verifier.** A standalone verifier recomputes the
  whole chain from an exported set of rows and reports `CHAIN OK` or the exact
  index where continuity breaks. The prior work had no independent verifier and
  nothing reproducible with the network off. (Provenance note: the contract's
  `get-audit` returns `{salt, events}`; the shipped `proxy/custody.mjs` maps
  `events` to the `rows` field the verifier reads, so the exports use `rows`.)
- **Dual-tenant cross-anchor.** Two independently-claimed tenants each seal the
  other's chain head into their own chain (`head()` / `seal_peer()`), over the
  already-proven client `executeAndDecode` transport. Forging history therefore
  requires corrupting two separately-claimed tenants, not one. `mesh-seller` was
  single-tenant and had no cross-anchor.
- **Keyless agent via an MCP custody proxy.** A real MCP stdio server holds the
  key in a closure and exposes only `act / head / verify / file`; the agent
  process holds no key and reaches the chain only through recorded verbs.
  `mesh-seller` had no MCP surface and no key-custody boundary.
- **Client-side regulator filing.** `render-filing.mjs` re-verifies the chain
  and renders an audit/regulator filing where every line cites its evidence
  hash. No equivalent existed in the prior work.
- **Delegation / authority (a second crypto surface).** A signed delegation
  credential (RFC-8785 JCS + EIP-191 user signature + secp256k1 agent
  invocation) is committed on-chain and an out-of-mandate action is refused and
  recorded; re-verifiable offline. `mesh-seller` had only the in-Rust spend-cap
  check — no credential, no second crypto primitive, no signer recovery.

## Summary

Inherited: the in-enclave governance chassis (caller DID, host seq/timestamp,
namespaced `kv_store`, secret masking, audit-write / get-audit). New: the
salted hash-chain, the generalized `record-action`, the offline verifier, the
dual-tenant cross-anchor, the keyless MCP custody proxy, the client-side
regulator filing, and the delegation/authority second crypto surface — i.e.,
the receipt-runtime category itself, not the agent-commerce demo the beta was.
We disclose the shared chassis here deliberately and in full.
