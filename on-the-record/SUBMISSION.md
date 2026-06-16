# SUBMISSION MANIFEST — "On the Record" (THE RECEIPT)

An agent runtime where **acting** and **producing tamper-evident evidence of the
act** are *one atomic in-enclave transaction*. Proven on the Terminal 3 testnet,
and reproducible end-to-end **offline** (no network, no SDK, no credits).

This manifest lists exactly what ships, how to verify it in one command with the
network off, and what is proven versus deferred.

---

## 1. What ships

All paths are absolute.

### Contract (Rust → wasm)

| Item | Path |
|---|---|
| Contract source | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/terminal3-agent-mesh/contracts/on-the-record/src/lib.rs` |
| Cargo manifest | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/terminal3-agent-mesh/contracts/on-the-record/Cargo.toml` (crate `on-the-record` v0.1.0, MIT) |
| WIT world | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/terminal3-agent-mesh/contracts/on-the-record/wit/world.wit` |
| Built wasm (release) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/terminal3-agent-mesh/contracts/on-the-record/target/wasm32-wasip2/release/on_the_record.wasm` (≈180 KB) |
| Native test target | `cargo test --target x86_64-unknown-linux-gnu` (5 unit + 1 doc-test) |

Verbs: `record-action` (grant-checked; emits an `allowed` or `denied` chained
row), `revoke(target_did)` (owner-only), `get-audit` (owner-or-auditors),
`head()` (returns chain tail hash, appends nothing), `seal-peer(peer_did,
peer_head)` (chained seal row), `reset` (owner-only).

Hash rule (one rule, used for every row including seals):
```
hash = hex( SHA256( utf8(salt) || hexdecode(prev_hash) || canonical_json(record_without_hash) ) )
genesis prev_hash = 64 zeros
salt = public per-tenant string  "on-the-record:v1:<tenant_id>"
```
Row shape: `{ seq, ts, caller_did, action, outcome('allowed'|'denied'), masked_secret, reason, prev_hash, hash }`.

### Offline verifier + filing (pure Node, zero SDK, zero network)

| Item | Path |
|---|---|
| Verifier | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/verifier.mjs` |
| Verifier tests (24/24) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/verifier.test.mjs` |
| Filing renderer | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/render-filing.mjs` |
| Rendered filing (output) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/filing.md` |

### Exports (captured testnet rows — verbatim, never re-run)

| Item | Path | Contents |
|---|---|---|
| Refusal chain | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/export.json` | ALLOWED seq 29263 → DENIED-after-revoke seq 29270 (`reason: no_active_grant`) |
| Cross-anchor tenant A | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/export-a2.json` | Account 2, 2 rows; head `4e9e…0619` (seq 35984) seals A3's real head `c4ac…8411` |
| Cross-anchor tenant B | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/export-a3.json` | Account 3 seal seq 29406, head `c4ac…8411`; seals A2's real head `0092…e07a` |
| Keyless-agent run | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/export-agent.json` | 5 rows, CHAIN OK; 3 acts produced by the keyless agent through the proxy (seq 29680 / 29686 / 29692) |

### MCP custody proxy + keyless agent loop (transport: real MCP stdio — tier 1)

| Item | Path |
|---|---|
| MCP stdio custody proxy | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/proxy/mcp-server.mjs` |
| Custody core (only module that touches the key; closure-private, no key getter) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/proxy/custody.mjs` |
| Proxy proof harness (scripted single act over a real MCP `Client`) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/proxy/prove.mjs` |
| Credit-floor probe (custody-side, keyless agent stays key-free) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/proxy/usage-probe.mjs` |
| Keyless agent loop (brain = `claude` CLI, hands = MCP proxy) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/agent-loop.mjs` |

The agent process asserts it holds **no** `T3N_API_KEY*` (and no model API key);
the proxy sources Account 3's key from `.env` on its own side and exposes only
`act / head / verify / file`. No tool input field is key-shaped. The agent's only
path to the chain is the proxy's `act()` — verified by a negative check (no key →
cannot construct a signer). **Honest note on transport:** the agent↔proxy link is
a genuine MCP stdio server + MCP `Client` (tier 1 / BEST, not a mock). The only
non-MCP steps are the custody-side credit read and export write, deliberately kept
off the agent so it never gains a key or a read path.

### Documents

| Item | Path |
|---|---|
| Canonical entry README | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/README.md` |
| Provenance disclosure (mesh-seller lineage) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/PROVENANCE.md` |
| Track-2 bug report #1 (`set-claims-digest` write-only sink) | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/track2-report-01-claims-digest.md` |
| This manifest | `/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/SUBMISSION.md` |

### On-chain registrations (already done — do not re-run)

| Registration | Contract id | Account |
|---|---|---|
| Refusal demo (allowed → revoke → denied) | 107 | Account 2 |
| Cross-anchor, tenant A | 110 | Account 2 |
| Cross-anchor, tenant B | 111 | Account 3 |

---

## 2. One-command offline reproduction

No credits, no network, no SDK. Pure Node `crypto` + the `cargo` native target.
All commands use absolute paths so they run from anywhere.

```bash
# (a) refusal chain verifies end-to-end  -> CHAIN OK 2 rows
node "/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/verifier.mjs" \
     "/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/export.json"

# (b) two tenants genuinely anchor each other  -> CROSS-ANCHOR OK
node "/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/verifier.mjs" --cross \
     "/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/export-a2.json" \
     "/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/export-a3.json"

# (c) verifier self-tests (24 checks incl. adversarial forgery/shadow/rewrite/broken-peer)  -> ALL TESTS PASSED
node "/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/verifier.test.mjs"

# (d) render the regulator/audit filing over the verified chain  -> FILING RENDERED
node "/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/render-filing.mjs"

# (e) contract native tests  -> 5 unit + 1 doc-test pass
( cd "/media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/terminal3-agent-mesh/contracts/on-the-record" \
  && cargo test --target x86_64-unknown-linux-gnu )
```

Tamper check: flip one byte in any row of `export.json` (without recomputing its
hash) and re-run (a) — the verifier reports `BROKEN AT seq=<row>`.

---

## 3. What's proven vs what's deferred

### Proven (and offline-reproducible right now)

- **Receipt-as-substrate.** Acting and recording are one in-enclave write; a
  refusal is itself a chained `denied` receipt, not an absent log line.
- **Salted hash-chain continuity.** ALLOWED seq 29263 → DENIED seq 29270
  (`no_active_grant`) chains directly; any edit breaks the chain at that seq, and
  the offline verifier detects it.
- **Dual-tenant cross-anchor (`CROSS-ANCHOR OK` on real testnet data).** Account
  2 (id 110) and Account 3 (id 111) each seal the other's **real head**: A2's
  head seals A3's real head `c4ac…8411`, and A3 seals A2's real head `0092…e07a`.
  Both directions bind, so neither tenant can rewrite its history without
  breaking the other's anchor. (The two anchors are accounts we control, so this
  proves the mechanism; full independence is when third parties run the anchors —
  see "Stated honest limit".)
- **Offline verification.** `verifier.mjs` recomputes every hash from the public
  salt with built-in SHA-256 only; 24/24 self-tests pass, including adversarial negative
  cross-anchor cases (forged head, rewritten body).
- **Client-side filing.** `render-filing.mjs` re-verifies the chain and refuses
  to render if broken; `filing.md` cites each row's evidence hash + prev_hash
  link (EU AI Act Art. 12-style record-keeping extract).
- **Contract correctness.** Native cargo tests cover canonical-JSON key sorting,
  genesis 64-zeros, salt-dependence of the hash, row chaining, and seal-row
  chaining carrying the peer head.
- **MCP custody proxy + keyless agent.** A real MCP stdio server holds Account 3's
  key in a closure and exposes only `act/head/verify/file`. A keyless agent
  (brain = local `claude` CLI, no model key; no `T3N_API_KEY*` in its env) reaches
  the chain ONLY through the proxy: 3 autonomous acts → `CHAIN OK 5 rows`
  (`export-agent.json`), Account 3 at 13,592 credits (> 10k floor). The custody
  property is enforced (key-free tool schema) and falsifiable (no key → no signer).

### Deferred (each is an upgrade — the entry is complete without it)

- **Examiner DID.** A dedicated third-party auditor identity with scoped
  `get-audit` access, distinct from owner. The owner/auditor ACL path already
  exists; this is a real independent examiner principal on top of it.
- **Unified single-deployment demo.** One scripted run that registers, exercises
  the refusal chain, and cross-anchors in a single pass. Today these are proven
  as separate registered artifacts (107 / 110 / 111) with captured exports; the
  unification is presentational, not a missing capability.

These are deliberately scoped out. The entry's floor — the receipt substrate,
the hash-chain, the cross-anchor, and the offline verifier — is built, on-chain,
and reproducible with the network off.

### Stated honest limit (not a gap)

Tamper-**evident**, not tamper-**proof**: the chain makes modification
*detectable*, not *impossible*. The "cluster-signed" property is intentionally
**not** claimed because the SDK lacks a client read path for the CCF leaf — filed
as Track-2 #1 (`track2-report-01-claims-digest.md`).
