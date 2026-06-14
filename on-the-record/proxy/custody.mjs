// ============================================================================
// CUSTODY CORE — "On the Record" MCP custody proxy.
//
// This is the ONLY module that ever touches Account 3's T3N key. The key is
// read from the environment ONCE, captured in a closure inside makeCustody(),
// and is NEVER returned, logged, or placed on any value that crosses the tool
// surface. Callers receive a frozen object whose methods invoke recorded verbs
// on Account 3's own contract (cross-anchor id 111) and hand back only the
// chained receipt row / rendered filing / verifier result.
//
//   act(action)  -> record-action on z:<acct3>:on-the-record  => chained row
//   head()       -> chain head (no row appended)
//   getAudit()   -> full trail rows + salt (owner read)        => for file()/verify()
//   seedGrant()  -> owner-only: grant:<acct3>="active" via control-plane (setup)
//   usage()      -> Account 3 credit balance (read-only)
//
// Transport reuses the PROVEN pattern from sdk-test/otr-*.mjs (T3nClient
// handshake/authenticate, executeAndDecode for verbs, executeControl
// map-entry-set for owner seeding). Account 3 is BOTH the funded caller AND the
// owner of id 111, so every op here is own-tenant (credit-safe, no re-register,
// no cross-tenant grant).
// ============================================================================

import {
  T3nClient, loadWasmComponent, setEnvironment,
  createEthAuthInput, eth_get_address, metamask_sign,
  getNodeUrl, getScriptVersion,
} from "@terminal3/t3n-sdk";

const TAIL = "on-the-record";

// Decode whatever executeAndDecode / executeControl hands back into a JS object.
function decode(out) {
  if (out == null) return null;
  if (typeof out === "object" && !Array.isArray(out) && !(out instanceof Uint8Array)) return out;
  let bytes = out;
  if (Array.isArray(out)) bytes = Uint8Array.from(out);
  if (typeof out === "string") { try { return JSON.parse(out); } catch { return out; } }
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return out; }
}

// Build the custody surface. The key argument is captured here and never escapes.
// Returns a frozen object exposing ONLY recorded verbs — no key getter exists.
export async function makeCustody({ key, env = "testnet" } = {}) {
  if (!key || typeof key !== "string") {
    throw new Error("custody: no T3N key provided (set T3N_API_KEY_3 in the proxy's env)");
  }

  // ---- key lives ONLY in these two locals; both are closure-private. --------
  const pk = key.startsWith("0x") ? key : `0x${key}`;
  const address = eth_get_address(pk);
  // Drop the original reference; only `pk`/`address` remain, inside this scope.
  key = null;

  setEnvironment(env);
  const wasmComponent = await loadWasmComponent();
  const client = new T3nClient({
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, pk) },
  });
  await client.handshake();
  const did = await client.authenticate(createEthAuthInput(address));
  const didStr = did?.value ?? String(did);
  const tid = didStr.slice("did:t3n:".length);
  const scriptName = `z:${tid}:${TAIL}`;
  const nodeUrl = getNodeUrl();
  let version = await getScriptVersion(nodeUrl, scriptName).catch(() => "0.1.0");

  // Owner self-invoke of a verb that APPENDS or READS via the Session API.
  async function invoke(functionName, input = {}) {
    return decode(await client.executeAndDecode({
      script_name: scriptName,
      script_version: version,
      function_name: functionName,
      input,
    }));
  }

  // ---- recorded verbs (the agent-facing surface) ----------------------------

  // act(action): record one action. Returns the chained receipt row, NOT the key.
  // `action` may be a string or a JSON-serializable descriptor.
  async function act(action, extra = {}) {
    if (action === undefined || action === null || action === "") {
      throw new Error("act: action is required");
    }
    const input = typeof action === "string" ? { action, ...extra } : { ...action, ...extra };
    const row = await invoke("record-action", input);
    if (!row || typeof row !== "object") {
      throw new Error("act: unexpected contract response: " + JSON.stringify(row));
    }
    return row;
  }

  // head(): current chain head hash. No row appended.
  async function head() {
    const out = await invoke("head", {});
    return out?.head ?? null;
  }

  // getAudit(): full trail (owner read) -> { salt, rows }. Feeds file()/verify().
  async function getAudit() {
    const aud = await invoke("get-audit", {});
    if (!aud?.events) throw new Error("get-audit returned no events: " + JSON.stringify(aud));
    return { salt: aud.salt, rows: aud.events };
  }

  // usage(): Account 3 credit balance (read-only; for credit discipline checks).
  async function usage() {
    return (await client.getUsage()).balance.available;
  }

  // --- owner-only SETUP op (not part of the agent surface) -------------------
  // seedGrant(): ensure policy grant:<acct3_did> = "active" on id 111 via the
  // control plane (bypasses contract-scoped ACL; cheap owner map write). Idempotent.
  async function seedGrant() {
    // TenantClient.canonicalName/executeControl require a TenantClient; build a
    // minimal one here so the key still never leaves custody.
    const { TenantClient } = await import("@terminal3/t3n-sdk");
    const tenant = new TenantClient({ environment: env, t3n: client, tenantDid: didStr, baseUrl: nodeUrl });
    const mapName = tenant.canonicalName("policy");
    const grantKey = `grant:${didStr}`;
    await tenant.executeControl("map-entry-set", { map_name: mapName, key: grantKey, value: "active" });
    return { granted: didStr, key: grantKey, value: "active" };
  }

  // Public, key-free identity for receipts/diagnostics (DID and address are
  // public; the private key is not derivable from them).
  const identity = Object.freeze({ did: didStr, tid, address, scriptName, version });

  // Frozen surface. There is deliberately NO method that returns the key.
  return Object.freeze({
    identity,
    act, head, getAudit, usage, seedGrant,
    // expose version setter only for internal re-resolve, not the key.
    _refreshVersion: async () => { version = await getScriptVersion(nodeUrl, scriptName).catch(() => version); return version; },
  });
}
