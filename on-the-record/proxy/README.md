# MCP Custody Proxy — "On the Record"

The proxy custodies **Account 3's T3N key** so the agent owns ZERO keys and can
reach the chain ONLY through recorded verbs. The key is read from the proxy
process's own environment exactly once, captured in a closure inside
`custody.mjs`, and is NEVER accepted or returned across the tool surface.

## Transport (tier 1 — BEST)

A **real MCP stdio server** built on `@modelcontextprotocol/sdk` (v1.29.0).
Tools are exposed over stdio JSON-RPC; an MCP `Client` connects and calls them.

## Files

| File | Role |
| --- | --- |
| `custody.mjs` | The ONLY module that touches the key. Captures it in a closure; exposes `act / head / getAudit / usage / seedGrant`. No key getter exists. |
| `mcp-server.mjs` | The MCP stdio server. Reads `T3N_API_KEY_3` from env once, hands it to custody, scrubs its own copy. Registers tools `act / head / verify / file`. |
| `prove.mjs` | Proof harness: the "agent". Spawns the server, connects an MCP `Client`, asserts the key is unreachable through the schema, calls `act()` ONCE, then `head/verify/file`, exports the trail, runs the offline verifier, checks the credit floor. |

## Tool surface (agent-facing — no key in or out)

| Tool | Input | Output |
| --- | --- | --- |
| `act`  | `{ action: string, amount_cents?: int, note?: string }` | chained receipt row: `{ seq, ts, caller_did, action, outcome, masked_secret, reason, prev_hash, hash }` |
| `head` | `{}` | `{ head: <64-hex> }` |
| `verify` | `{}` | `{ ok, n, head, rows }` (offline verifier over the live chain) |
| `file` | `{}` | regulator/audit filing markdown (refuses if chain BROKEN) |

`act()` invokes the grant-checked `record-action` verb on Account 3's own
contract `z:3f6988bd…:on-the-record` (cross-anchor id 111). Account 3 is BOTH
the funded caller AND the owner, so every op is own-tenant (credit-safe).

## Run

```sh
# server (key lives only here, in custody)
T3N_API_KEY_3=<key> node mcp-server.mjs

# proof harness (the agent — spawns the server, never holds the key on its tools)
T3N_API_KEY_3=<key> node prove.mjs
```

## Proven properties

- `key_never_in_tool_schema: true` — no tool input field is key-shaped, and the
  returned row contains no raw key material.
- `act()` produced a REAL chained row on testnet (host-stamped `seq`/`ts`,
  `caller_did` = Account 3, valid 64-hex `hash`/`prev_hash` linking to the head).
- offline verifier: `CHAIN OK` over `../export-agent.json`.
- credit discipline: Account 3 stays above the 10,000 floor; Account 2 is never
  used as a writer.
