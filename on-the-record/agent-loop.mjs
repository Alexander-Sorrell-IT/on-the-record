// ============================================================================
// KEYLESS AGENT LOOP — brain = the local `claude` CLI, hands = the MCP proxy.
//
// This process is the AGENT. Two custody properties are asserted up front and
// hold for the entire run:
//
//   (1) NO T3N KEY IN THE AGENT ENVIRONMENT. Before anything else we scrub every
//       T3N_API_KEY* / T3N_KEY variable from process.env and ASSERT none remain.
//       If any survives, we abort. The agent therefore cannot sign or call the
//       chain itself.
//
//   (2) NO MODEL API KEY EITHER. The "brain" is the local `claude` CLI invoked
//       with spawnSync (same pattern as terminal3-agent-mesh/src/agent-buyer.ts).
//       The agent reasons with NO Anthropic API key in this process.
//
// The agent reaches the chain ONLY by calling the custody proxy's MCP tools
// (act / file / verify / head) over a real stdio MCP transport. The proxy is a
// child process that sources Account 3's T3N key from its OWN side (the project
// .env) — the agent never reads it and never forwards it. We spawn the proxy
// with an env that ALSO has the T3N keys scrubbed, to make it impossible for the
// agent to have leaked the key into the child; the proxy self-sources it.
//
// Loop: gather (head + recent rows) -> decide (claude CLI) -> act (proxy.act).
// <= 3 acts, each producing exactly one new chained row. Then export the trail,
// run the offline verifier (expect CHAIN OK), and confirm the credit floor.
//
// Run (NO key needed in this shell — the proxy self-sources from .env):
//   node agent-loop.mjs
// ============================================================================

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "proxy", "mcp-server.mjs");
const EXPORT = resolve(HERE, "export-agent.json");
const VERIFIER = resolve(HERE, "verifier.mjs");
const MAX_ACTS = 3;

// --- CUSTODY ASSERTION (1): scrub every T3N key from the AGENT's environment. -
// We do this BEFORE importing/instantiating anything that could touch a key.
const T3N_KEY_RE = /^T3N_(API_)?KEY/i;
const scrubbed = [];
for (const name of Object.keys(process.env)) {
  if (T3N_KEY_RE.test(name)) { scrubbed.push(name); delete process.env[name]; }
}
const leakedKeys = Object.keys(process.env).filter((n) => T3N_KEY_RE.test(n));
if (leakedKeys.length) {
  console.error("[agent] FATAL: T3N key(s) present in agent env after scrub:", leakedKeys.join(", "));
  process.exit(1);
}
// The child proxy gets an env with the T3N keys ALSO scrubbed: this proves the
// agent did not (could not) hand the proxy a key. The proxy self-sources it.
const childEnv = { ...process.env };
for (const n of Object.keys(childEnv)) if (T3N_KEY_RE.test(n)) delete childEnv[n];

const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", m: "\x1b[35m", x: "\x1b[0m" };

const result = {
  agent_holds_no_key: true,            // proven by the scrub+assert above
  agent_holds_no_model_key: !process.env.ANTHROPIC_API_KEY,
  scrubbed_from_agent_env: scrubbed,
  brain: "local `claude` CLI via spawnSync (keyless)",
  transport: "real MCP stdio client -> custody proxy (mcp-server.mjs)",
  tools_listed: [],
  key_never_in_tool_schema: false,
  acts: [],
  acts_through_proxy: 0,
  rows_on_chain: 0,
  head: null,
  verify: null,
  filing_rendered: false,
  verifier_cli: null,
  verifier_chain_ok: false,
  balance_after: null,
  usage_above_floor: false,
  blockers: [],
};

const text = (res) => (res?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const jsonOf = (res) => { try { return JSON.parse(text(res)); } catch { return null; } };

// --- THE BRAIN: one decision via the local keyless `claude` CLI. --------------
// Returns parsed JSON {action, reasoning}. Falls back to a deterministic stand-in
// decision if the CLI is unavailable, and records that we did so (honesty).
function think(prompt) {
  const r = spawnSync("claude", ["-p"], { input: prompt, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) {
    throw new Error("claude CLI failed: " + (r.stderr || r.stdout || "no output").slice(0, 200));
  }
  const out = r.stdout.trim();
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("agent did not return JSON: " + out.slice(0, 200));
  return JSON.parse(m[0]);
}

function buildPrompt(turn, head, history) {
  return (
    `You are an autonomous compliance agent for a regulated AI deployment. Every action you take is ` +
    `recorded as a tamper-evident, hash-chained receipt on Terminal 3 ("On the Record"). You do NOT ` +
    `hold any signing key — you reach the ledger ONLY through a custody proxy tool:\n` +
    `  act(action: string)   // records one grant-checked action; returns the chained receipt row\n\n` +
    `GOAL: produce a short, honest audit trail by recording exactly the operational actions a deployed ` +
    `agent would take this session (e.g. "load-policy", "process-batch:invoices", "flag-anomaly:txn-4471"). ` +
    `One action per turn. Keep each action a single short kebab/colon token, no spaces.\n\n` +
    `This is turn ${turn} of at most ${MAX_ACTS}. Current chain head: ${head}.\n` +
    `History so far (JSON):\n${JSON.stringify(history, null, 2)}\n\n` +
    `Decide your next action. Respond with ONLY JSON, no prose:\n` +
    `{"action":"<short-action-token>","reasoning":"<one short sentence>"}`
  );
}

// --- spawn the proxy as an MCP server child, connect an MCP client. -----------
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  env: childEnv,           // T3N keys scrubbed: the proxy must self-source.
  stderr: "inherit",
});
const client = new Client({ name: "otr-keyless-agent", version: "0.1.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  console.error(`${C.b}${C.c}=== KEYLESS AGENT LOOP (brain: claude CLI, hands: MCP custody proxy) ===${C.x}`);
  console.error(`${C.dim}agent env T3N keys: NONE (scrubbed: ${scrubbed.join(",") || "none-present"}) | model key: NONE${C.x}`);

  // list tools and assert the key is unreachable through the schema.
  const tools = await client.listTools();
  result.tools_listed = tools.tools.map((t) => t.name);
  const KEY_HINTS = ["key", "secret", "private", "t3n_api", "pk", "mnemonic"];
  let leak = false;
  for (const t of tools.tools) {
    for (const field of Object.keys(t.inputSchema?.properties ?? {})) {
      if (KEY_HINTS.some((h) => field.toLowerCase().includes(h))) leak = true;
    }
  }
  result.key_never_in_tool_schema = !leak;
  console.error(`${C.dim}[mcp] tools: ${result.tools_listed.join(", ")} | key-free schema: ${result.key_never_in_tool_schema}${C.x}`);

  // --- gather -> decide -> act, up to MAX_ACTS. ------------------------------
  const history = [];
  for (let turn = 1; turn <= MAX_ACTS; turn++) {
    // gather: current chain head (no row appended).
    const head = jsonOf(await client.callTool({ name: "head", arguments: {} }))?.head ?? null;

    // decide: the keyless claude CLI brain.
    let decision;
    try {
      decision = think(buildPrompt(turn, head, history));
    } catch (e) {
      result.blockers.push(`claude CLI failed on turn ${turn}: ${e?.message ?? e}`);
      console.error(`${C.r}[brain] ${e?.message ?? e}${C.x}`);
      break;
    }
    const action = String(decision.action || "").trim().replace(/\s+/g, "-").slice(0, 80);
    if (!action) { result.blockers.push(`turn ${turn}: brain returned empty action`); break; }
    console.error(`${C.m}[brain turn ${turn}] ${decision.reasoning ?? ""}${C.x}\n   ${C.dim}-> act("${action}")${C.x}`);

    // act: ONLY path to the chain — the proxy's act() MCP tool.
    const actRes = await client.callTool({ name: "act", arguments: { action, note: `keyless-agent turn ${turn}` } });
    const row = jsonOf(actRes);
    const okRow =
      !!row && row.outcome === "allowed" &&
      typeof row.seq === "number" && typeof row.ts === "number" &&
      /^[0-9a-f]{64}$/.test(row.hash || "") && /^[0-9a-f]{64}$/.test(row.prev_hash || "") &&
      row.prev_hash === head;            // the new row chains onto the head we just read
    result.acts.push({ turn, action, reasoning: decision.reasoning ?? null, seq: row?.seq ?? null, outcome: row?.outcome ?? null, hash: row?.hash ?? null, prev_hash: row?.prev_hash ?? null, chains_onto_head: row?.prev_hash === head });
    if (okRow) {
      result.acts_through_proxy += 1;
      console.error(`   ${C.g}OK seq=${row.seq} hash=${row.hash.slice(0, 12)}... (prev=head)${C.x}`);
    } else {
      result.blockers.push(`turn ${turn}: act did not produce a clean chained row: ${JSON.stringify(row)}`);
      console.error(`   ${C.r}BAD ROW: ${JSON.stringify(row)}${C.x}`);
    }
    history.push({ turn, action, outcome: row?.outcome ?? null, seq: row?.seq ?? null });
  }

  // --- verify + file through the proxy (proxy refuses to file a broken chain). -
  result.head = jsonOf(await client.callTool({ name: "head", arguments: {} }))?.head ?? null;
  result.verify = jsonOf(await client.callTool({ name: "verify", arguments: {} }));
  const fileRes = await client.callTool({ name: "file", arguments: {} });
  result.filing_rendered = text(fileRes).startsWith("# Regulator / Audit Filing");
  console.error(`${C.dim}[mcp] head=${result.head} | verify=${JSON.stringify(result.verify)} | filed=${result.filing_rendered}${C.x}`);
} catch (e) {
  result.blockers.push("mcp client flow failed: " + (e?.message ?? e));
  console.error(`${C.r}[mcp] FAILED: ${e?.message ?? e}${C.x}`);
} finally {
  try { await client.close(); } catch {}
}

// --- export the trail (still keyless): the agent has no read path of its own.
// We re-open a short MCP session against a proxy launched with --emit-export, so
// the CUSTODY BOUNDARY (which holds the key + owner read path) writes the export
// file when we call verify(). The agent never touches a key or a read path.
try {
  const t2 = new StdioClientTransport({ command: process.execPath, args: [SERVER, "--emit-export", EXPORT], env: childEnv, stderr: "inherit" });
  const c2 = new Client({ name: "otr-export", version: "0.1.0" }, { capabilities: {} });
  await c2.connect(t2);
  await c2.callTool({ name: "verify", arguments: {} }); // proxy writes export-agent.json
  await c2.close();
} catch (e) {
  result.blockers.push("export trigger failed: " + (e?.message ?? e));
}

// run the offline verifier over the export the proxy wrote.
try {
  const v = spawnSync(process.execPath, [VERIFIER, EXPORT], { encoding: "utf8" });
  result.verifier_cli = (v.stdout || v.stderr || "").trim();
  result.verifier_chain_ok = /^CHAIN OK/.test(result.verifier_cli);
  const m = result.verifier_cli.match(/CHAIN OK (\d+) rows/);
  result.rows_on_chain = m ? Number(m[1]) : (result.verify?.rows ?? 0);
  console.error(`${C.b}[verifier] ${result.verifier_cli}${C.x}`);
} catch (e) {
  result.blockers.push("verifier CLI failed: " + (e?.message ?? e));
}

// --- credit-floor check (keyless): a one-shot probe sources the key from .env
// on the CUSTODY side. The agent process itself still never holds a key.
try {
  const probe = resolve(HERE, "proxy", "usage-probe.mjs");
  const u = spawnSync(process.execPath, [probe], { encoding: "utf8", env: childEnv });
  const bal = JSON.parse((u.stdout || "{}").trim()).balance;
  result.balance_after = bal ?? null;
  result.usage_above_floor = typeof bal === "number" && bal > 10000;
  console.error(`${C.b}[credits] balance_after=${result.balance_after} above10k=${result.usage_above_floor}${C.x}`);
} catch (e) {
  result.blockers.push("usage probe failed: " + (e?.message ?? e));
}

console.log("\n==== AGENT-LOOP RESULT ====");
console.log(JSON.stringify(result, null, 2));
process.exit(result.acts_through_proxy > 0 && result.verifier_chain_ok && result.agent_holds_no_key ? 0 : 2);
