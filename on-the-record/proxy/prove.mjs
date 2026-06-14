// ============================================================================
// PROOF HARNESS — drives the MCP custody proxy as an MCP CLIENT over stdio.
//
// This is the OWNER / bootstrap harness, NOT the keyless-agent demonstration.
// It DOES hold the T3N key: it reads T3N_API_KEY_3 from its own env (below),
// uses it in-process for owner operations (grant seeding + owner audit/usage
// reads via custody.mjs), AND forwards it into the spawned server's env. So this
// process both sees and forwards the key by design — it exists to prove the MCP
// tool surface works end-to-end and to seed/read as the owner.
// For the genuinely KEYLESS property (an agent that scrubs every T3N key from
// its env and reaches the chain only through the proxy), see agent-loop.mjs.
//
// Steps:
//   0. (setup, owner, credit-safe) seed grant:<acct3>="active" on id 111 via a
//      one-shot custody call in a SEPARATE process so the server stays pure MCP.
//   1. spawn the MCP stdio server, connect an MCP Client.
//   2. list tools -> assert NO tool has any key-shaped input field.
//   3. act("transfer:invoice-...") ONCE -> assert a real chained row comes back.
//   4. head(), verify(), file().
//   5. export the trail to ../export-agent.json, run the offline verifier CLI.
//   6. confirm getUsage(acct3) stays > 10000.
//
// Run:  T3N_API_KEY_3=<key> node prove.mjs
// ============================================================================

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { makeCustody } from "./custody.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "mcp-server.mjs");
const EXPORT = resolve(HERE, "..", "export-agent.json");
const VERIFIER = resolve(HERE, "..", "verifier.mjs");

const KEY = process.env.T3N_API_KEY_3;
if (!KEY) { console.error("need T3N_API_KEY_3"); process.exit(1); }

const result = {
  transport: "real MCP stdio server (@modelcontextprotocol/sdk)",
  tools_listed: [],
  key_never_in_tool_schema: false,
  grant_seeded: null,
  act_row: null,
  invoke_produced_row: false,
  head: null,
  verify: null,
  filing_rendered: false,
  filing_preview: null,
  balance_before: null,
  balance_after: null,
  usage_above_floor: false,
  verifier_cli: null,
  blockers: [],
};

const text = (res) => (res?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const jsonOf = (res) => { try { return JSON.parse(text(res)); } catch { return null; } };

// --- 0. SETUP: seed grant + record balance via a one-shot custody (own-tenant).
//     This is the owner bootstrap; it does not run inside the MCP server.
let custodyForSetup;
try {
  custodyForSetup = await makeCustody({ key: KEY });
  result.balance_before = await custodyForSetup.usage();
  result.grant_seeded = await custodyForSetup.seedGrant();
  console.error("[setup] grant seeded:", JSON.stringify(result.grant_seeded), "balance:", result.balance_before);
} catch (e) {
  result.blockers.push("setup(seedGrant) failed: " + (e?.message ?? e));
}

// --- 1. spawn server + connect client. The key goes to the SERVER's env only.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  env: { ...process.env, T3N_API_KEY_3: KEY },
  stderr: "inherit",
});
const client = new Client({ name: "otr-agent", version: "0.1.0" }, { capabilities: {} });

try {
  await client.connect(transport);

  // --- 2. list tools and assert the key is unreachable through the schema.
  const tools = await client.listTools();
  result.tools_listed = tools.tools.map((t) => t.name);
  const KEY_HINTS = ["key", "secret", "private", "t3n_api", "pk", "mnemonic"];
  let leak = false;
  for (const t of tools.tools) {
    const props = t.inputSchema?.properties ?? {};
    for (const field of Object.keys(props)) {
      if (KEY_HINTS.some((h) => field.toLowerCase().includes(h))) { leak = true; break; }
    }
  }
  result.key_never_in_tool_schema = !leak;
  console.error("[mcp] tools:", result.tools_listed.join(", "), "| key-free schema:", result.key_never_in_tool_schema);

  // --- 3. act ONCE -> real chained row.
  const stamp = Date.now().toString().slice(-6);
  const actRes = await client.callTool({
    name: "act",
    arguments: { action: `proxy-act:invoice-${stamp}`, amount_cents: 4200, note: "MCP custody proxy demo act" },
  });
  const row = jsonOf(actRes);
  result.act_row = row;
  result.invoke_produced_row =
    !!row &&
    row.outcome === "allowed" &&
    row.caller_did === custodyForSetup?.identity?.did &&
    typeof row.seq === "number" &&
    typeof row.ts === "number" &&
    /^[0-9a-f]{64}$/.test(row.hash || "") &&
    /^[0-9a-f]{64}$/.test(row.prev_hash || "");
  // assert the row itself does not carry the key
  if (row && JSON.stringify(row).includes(KEY.replace(/^0x/, ""))) {
    result.blockers.push("KEY LEAK: act() row contained the raw key material");
    result.invoke_produced_row = false;
  }
  console.error("[act] row:", JSON.stringify(row));

  // --- 4. head / verify / file.
  result.head = jsonOf(await client.callTool({ name: "head", arguments: {} }))?.head ?? null;
  result.verify = jsonOf(await client.callTool({ name: "verify", arguments: {} }));
  const fileRes = await client.callTool({ name: "file", arguments: {} });
  const filing = text(fileRes);
  result.filing_rendered = filing.startsWith("# Regulator / Audit Filing");
  result.filing_preview = filing.split("\n").slice(0, 12).join("\n");
  console.error("[head]", result.head, "| [verify]", JSON.stringify(result.verify));
} catch (e) {
  result.blockers.push("mcp client flow failed: " + (e?.message ?? e));
  console.error("[mcp] FAILED:", e?.message ?? e);
} finally {
  try { await client.close(); } catch {}
}

// --- 5. export the trail (owner read via setup custody) + run verifier CLI.
try {
  const { salt, rows } = await custodyForSetup.getAudit();
  await writeFile(EXPORT, JSON.stringify({ salt, salt_string: salt, rows }, null, 2));
  console.error("[export] wrote", EXPORT, "rows:", rows.length);

  const { spawnSync } = await import("node:child_process");
  const v = spawnSync(process.execPath, [VERIFIER, EXPORT], { encoding: "utf8" });
  result.verifier_cli = (v.stdout || v.stderr || "").trim();
  console.error("[verifier]", result.verifier_cli);
} catch (e) {
  result.blockers.push("export/verify failed: " + (e?.message ?? e));
}

// --- 6. credit floor check.
try {
  result.balance_after = await custodyForSetup.usage();
  result.usage_above_floor = result.balance_after > 10000;
  console.error(`[credits] before=${result.balance_before} after=${result.balance_after} above10k=${result.usage_above_floor}`);
} catch (e) {
  result.blockers.push("final usage read failed: " + (e?.message ?? e));
}

console.log("\n==== PROVE RESULT ====");
console.log(JSON.stringify(result, null, 2));
process.exit(result.invoke_produced_row && result.key_never_in_tool_schema ? 0 : 2);
