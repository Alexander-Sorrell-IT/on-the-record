// ============================================================================
// MCP CUSTODY PROXY — real MCP stdio server (Transport tier 1).
//
// Holds Account 3's T3N key INSIDE the proxy process (custody.mjs closure) and
// exposes ONLY recorded verbs to an MCP client over stdio:
//
//   act   { action }  -> record-action on z:<acct3>:on-the-record (id 111),
//                        returns the chained receipt row (seq/ts/caller_did/
//                        outcome/masked_secret/prev_hash/hash). NEVER the key.
//   file  {}          -> renders the regulator/audit filing from the CURRENT
//                        chain (refuses if the chain is BROKEN).
//   verify{}          -> runs the offline verifier over the current chain.
//   head  {}          -> chain head hash.
//
// The agent-facing tool surface NEVER accepts or returns the T3N key: no tool
// takes a key argument, and no handler reads/returns one. The key is read from
// the environment exactly once, inside custody.mjs, and captured in a closure.
//
// Run:  T3N_API_KEY_3=<key> node mcp-server.mjs
// ============================================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { makeCustody } from "./custody.mjs";
import { verifyChain, chainHead } from "../verifier.mjs";
import { renderFiling } from "../render-filing.mjs";

// --- read the key from env ONCE, hand it to custody, then forget it here. ----
// The proxy is the custody boundary: it is the ONLY process allowed to source
// the secret. Prefer its own env; if absent, read it straight from the project
// .env (so the AGENT process can run with NO key in its environment at all and
// still reach the chain only through this proxy). The key never reaches the
// agent — it is sourced here and immediately handed to custody.
function keyFromDotEnv() {
  try {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const envPath = resolve(HERE, "..", "..", ".env");
    const txt = readFileSync(envPath, "utf8");
    const m = txt.match(/^\s*T3N_API_KEY_3\s*=\s*(.+?)\s*$/m);
    return m ? m[1].replace(/^['"]|['"]$/g, "") : null;
  } catch { return null; }
}
const KEY =
  (process.env.T3N_API_KEY_3 && process.env.T3N_API_KEY_3 !== "***held-in-custody***" && process.env.T3N_API_KEY_3) ||
  process.env.T3N_KEY ||
  keyFromDotEnv();
if (!KEY) {
  process.stderr.write("[proxy] FATAL: T3N_API_KEY_3 not set in proxy env\n");
  process.exit(1);
}
const custody = await makeCustody({ key: KEY });
// Scrub our local reference; from here on the key exists only inside custody.
// (custody itself also nulled its own copy after deriving address/pk.)
process.env.T3N_API_KEY_3 = "***held-in-custody***";
process.env.T3N_KEY = "***held-in-custody***";

process.stderr.write(`[proxy] custody ready: DID=${custody.identity.did} script=${custody.identity.scriptName}\n`);

// Optional: when launched with `--emit-export <path>`, the proxy (which holds
// the key AND the owner read path) writes the verified trail to <path> on each
// verify() call. This lets a KEYLESS agent obtain export-agent.json without ever
// touching a key or a read path of its own — the custody boundary emits it.
const emitIdx = process.argv.indexOf("--emit-export");
const EMIT_EXPORT = emitIdx !== -1 ? process.argv[emitIdx + 1] : null;

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: JSON.stringify({ error: String(msg) }, null, 2) }], isError: true });

const server = new McpServer(
  { name: "otr-custody-proxy", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ---- act -------------------------------------------------------------------
server.registerTool(
  "act",
  {
    title: "Record an action on the chain",
    description:
      "Invoke the grant-checked record-action verb on Account 3's on-the-record contract " +
      "(cross-anchor id 111) and return the chained receipt row. The agent owns no key; " +
      "this is the ONLY way to reach the chain. Returns seq, ts, caller_did, outcome " +
      "(allowed|denied), masked_secret, reason, prev_hash, hash. The T3N key is never accepted or returned.",
    inputSchema: {
      action: z.string().min(1).describe("The action to record, e.g. 'transfer:invoice-7782'"),
      amount_cents: z.number().int().optional().describe("Optional amount in cents"),
      note: z.string().optional().describe("Optional human note attached to the action"),
    },
  },
  async ({ action, amount_cents, note }) => {
    try {
      const extra = {};
      if (amount_cents !== undefined) extra.amount_cents = amount_cents;
      if (note !== undefined) extra.note = note;
      const row = await custody.act(action, extra);
      return ok(row);
    } catch (e) {
      return fail(e?.message ?? e);
    }
  },
);

// ---- head ------------------------------------------------------------------
server.registerTool(
  "head",
  {
    title: "Chain head",
    description: "Return the current chain head hash of Account 3's receipt trail. No row is appended.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok({ head: await custody.head() });
    } catch (e) {
      return fail(e?.message ?? e);
    }
  },
);

// ---- verify ----------------------------------------------------------------
server.registerTool(
  "verify",
  {
    title: "Verify the receipt chain (offline)",
    description:
      "Pull the current trail via the owner read path and run the offline verifier " +
      "(same hash rule as verifier.mjs, zero network, zero key). Returns { ok, n } or " +
      "{ ok:false, brokenSeq } plus the chain head.",
    inputSchema: {},
  },
  async () => {
    try {
      const { salt, rows } = await custody.getAudit();
      const exportObj = { salt, salt_string: salt, rows };
      const v = verifyChain(exportObj);
      if (EMIT_EXPORT) {
        writeFileSync(EMIT_EXPORT, JSON.stringify(exportObj, null, 2));
        process.stderr.write(`[proxy] emitted export -> ${EMIT_EXPORT} (${rows.length} rows)\n`);
      }
      return ok({ ...v, head: chainHead(exportObj), rows: rows.length });
    } catch (e) {
      return fail(e?.message ?? e);
    }
  },
);

// ---- file ------------------------------------------------------------------
server.registerTool(
  "file",
  {
    title: "Render the regulator/audit filing",
    description:
      "Render a print-ready regulator/audit filing (markdown) from the CURRENT chain. " +
      "Re-verifies the chain first and REFUSES to render if it is BROKEN. Returns the " +
      "filing markdown plus the verified row count and chain head.",
    inputSchema: {},
  },
  async () => {
    try {
      const { salt, rows } = await custody.getAudit();
      const exportObj = { salt, salt_string: salt, rows };
      const md = renderFiling(exportObj, `live:${custody.identity.scriptName}`);
      return {
        content: [{ type: "text", text: md }],
        structuredContent: { rows: rows.length, head: chainHead(exportObj) },
      };
    } catch (e) {
      return fail(e?.message ?? e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[proxy] MCP stdio server connected. Tools: act, head, verify, file\n");
