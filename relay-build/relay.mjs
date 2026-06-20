// Baton-Relay verification mesh on Terminal 3 — D2: randomized 3-node loop.
// A user task enters at a node; the baton walks node->node by a COMMITTED random
// pick (parseInt(myHead.slice(-8),16) % candidates); each hop the receiver reads
// the predecessor's unforgeable did:t3n (cross-tenant record-action), independently
// re-fetches its head(), and BOTH nodes seal each other (owner path) => CROSS-ANCHOR OK.
// Reject path: head mismatch -> the receiver records relay:reject and halts.
import {
  T3nClient, TenantClient, loadWasmComponent, setEnvironment,
  createEthAuthInput, eth_get_address, metamask_sign, getNodeUrl, getScriptVersion,
} from "@terminal3/t3n-sdk";
import { readFile } from "fs/promises";
import { writeFileSync } from "fs";
import { execSync } from "child_process";

const TAIL = "on-the-record";
const DIR = decodeURIComponent(new URL(".", import.meta.url).pathname);
// Resolved relative to this script so the source ships with no absolute-path leak.
const WASM = decodeURIComponent(new URL("../terminal3-agent-mesh/contracts/on-the-record/target/wasm32-wasip2/release/on_the_record.wasm", import.meta.url).pathname);
const VERIFIER = decodeURIComponent(new URL("../on-the-record/verifier.mjs", import.meta.url).pathname);
setEnvironment("testnet");
const wasm = await loadWasmComponent();

function decode(o){ if(o==null)return null; if(typeof o==="object"&&!Array.isArray(o)&&!(o instanceof Uint8Array))return o;
  if(typeof o==="string"){try{return JSON.parse(o)}catch{return o}} try{return JSON.parse(Buffer.from(Array.isArray(o)?Uint8Array.from(o):o).toString("utf8"))}catch{return o} }

async function connect(key, label){
  const pk = key.startsWith("0x")?key:`0x${key}`; const address = eth_get_address(pk);
  const c = new T3nClient({ wasmComponent: wasm, handlers: { EthSign: metamask_sign(address, undefined, pk) } });
  await c.handshake();
  const didStr = (await c.authenticate(createEthAuthInput(address)))?.value;
  const tid = didStr.slice("did:t3n:".length);
  const node = { c, didStr, tid, script: `z:${tid}:${TAIL}`, version: "0.1.0", label, address };
  node.version = await getScriptVersion(getNodeUrl(), node.script).catch(()=>null);
  console.log(`[${label}] did=${didStr.slice(0,26)}.. ver=${node.version} bal=${(await c.getUsage()).balance.available}`);
  return node;
}
const bal = async (n) => (await n.c.getUsage()).balance.available;
const invoke = (node, fn, input, caller) => caller.c.executeAndDecode({ script_name: node.script, script_version: node.version, function_name: fn, input }).then(decode);
const recordAction = (host, action, caller) => invoke(host, "record-action", { action }, caller);
const headOf = (host, caller) => invoke(host, "head", {}, caller).then(o=>o?.head);
const sealPeer = (host, peerDid, peerHead, caller) => invoke(host, "seal-peer", { peer_did: peerDid, peer_head: peerHead }, caller);
const getAudit = (host, caller) => invoke(host, "get-audit", {}, caller).then(a=>({ salt:a.salt, rows:a.events }));
async function grant(host, did){
  const t = new TenantClient({ environment:"testnet", t3n: host.c, tenantDid: host.didStr, baseUrl: getNodeUrl() });
  await t.executeControl("map-entry-set", { map_name: t.canonicalName("policy"), key: `grant:${did}`, value: "active" });
}
async function ensureRegistered(node, knownId){
  const t = new TenantClient({ environment:"testnet", t3n: node.c, tenantDid: node.didStr, baseUrl: getNodeUrl() });
  let contractId = knownId;
  if (!node.version){
    const reg = await t.contracts.register({ tail: TAIL, version: "0.1.0", wasm: await readFile(WASM) });
    contractId = reg.contract_id; node.version = "0.1.0";
    console.log(`  ${node.label} REGISTERED contract_id=${contractId}`);
  } else console.log(`  ${node.label} already registered ver=${node.version} (id ${contractId})`);
  // ACL the policy/secrets/trail maps to the contract id (the missing setup step)
  const acl = { visibility:"private", writers:{ only:[contractId] }, readers:{ only:[contractId] } };
  for (const m of ["policy","secrets","trail"]){
    try { await t.maps.create({ tail:m, ...acl }); console.log(`  ${node.label} map ${m} created->${contractId}`); }
    catch(e){ if(String(e?.message).includes("already exists")){ await t.maps.update(m, {...acl}); console.log(`  ${node.label} map ${m} re-acl'd->${contractId}`); } else console.log(`  ${node.label} map ${m} note: ${e?.message}`); }
  }
  try { await t.contracts.execute(TAIL, { version: node.version, functionName: "reset", input: {} }); console.log(`  ${node.label} reset ok`); } catch(e){ console.log(`  ${node.label} reset note: ${e?.message}`); }
  const seed = (mt,k,v)=>t.executeControl("map-entry-set", { map_name: t.canonicalName(mt), key:k, value:v });
  await seed("secrets","witness",`sk_live_relay_${node.tid.slice(0,6)}`);
  await seed("policy","auditors",node.didStr);
  await seed("policy",`grant:${node.didStr}`,"active");
  console.log(`  ${node.label} setup complete (maps ACL'd + reset + seeded)`);
}

// One mutual hop prev -> next. Returns {ok, callerOk, nextHead}.
async function mutualHop(prev, next){
  const Hn_pre = await headOf(next, prev);                       // prev pins next.head
  await sealPeer(prev, next.didStr, Hn_pre, prev);               // prev seals next (owner)
  const Hp2 = await headOf(prev, prev);
  const hopRow = await recordAction(next, `relay:hop from=${prev.tid.slice(0,16)} ah=${Hp2}`, prev); // cross-tenant; next's enclave stamps caller
  const callerOk = hopRow?.caller_did === prev.didStr;
  const Hp_now = await headOf(prev, next);                       // next independently re-reads prev.head
  if (Hp_now !== Hp2){ await recordAction(next, `relay:reject from=${prev.tid.slice(0,16)}`, next); return { ok:false, callerOk, nextHead:null }; }
  await sealPeer(next, prev.didStr, Hp_now, next);               // next mutually seals prev (owner) -> CROSS-ANCHOR OK
  const Hn_post = await headOf(next, next);
  console.log(`  hop ${prev.label}->${next.label}: caller=${callerOk?"OK":"BAD"} match=${Hp_now===Hp2?"OK":"NO"} nextHead=${Hn_post.slice(0,16)}..`);
  return { ok:true, callerOk, nextHead: Hn_post };
}
function pickNext(holderHead, hosts, holder, visited){
  const cands = hosts.filter(h => h !== holder && !visited.includes(h));
  if (!cands.length) return null;
  const idx = parseInt(holderHead.slice(-8), 16) % cands.length;
  console.log(`  pickNext: head..${holderHead.slice(-8)} -> idx ${idx} of [${cands.map(c=>c.label).join(",")}] = ${cands[idx].label}`);
  return cands[idx];
}

// ===================== D2 =====================
const A = await connect(process.env.T3N_API_KEY_3, "A(acct3)");
const B = await connect(process.env.T3N_API_KEY_2, "B(acct2)");
const C = await connect(process.env.T3N_API_KEY,   "C(acct1)");
const start = { A: await bal(A), B: await bal(B), C: await bal(C) };

console.log("\n--- setup: register C(acct1) if needed + grant all dids on every host ---");
await ensureRegistered(C, 184);  // acct1's contract_id from its first register this session
const hosts = [A, B, C];
for (const h of hosts) for (const g of hosts) await grant(h, g.didStr);
console.log("  grants set (each host allows all 3 dids)");
let cHead0 = null; try { cHead0 = await headOf(C, C); } catch {}
if (!cHead0 || /^0+$/.test(cHead0)) { await recordAction(C, "node:online", C); console.log("  seeded C chain (was empty/uninit) so head() works"); }

console.log("\n--- baton: entry A records relay:start, then random walk through all nodes ---");
await recordAction(A, "relay:start u=demo task=t1", A);
let holder = A, H = await headOf(A, A), visited = [A], route = [A.label];
while (true){
  const next = pickNext(H, hosts, holder, visited);
  if (!next) break;
  let hop; try { hop = await mutualHop(holder, next); } catch(e){ console.log(`  hop ${holder.label}->${next.label} ERROR: ${(e?.message||String(e)).slice(0,180)}`); break; }
  if (!hop.ok){ console.log("  baton HALTED (reject) at", next.label); break; }
  holder = next; H = hop.nextHead; visited.push(next); route.push(next.label);
}
await recordAction(holder, "relay:answer result=done", holder);
console.log("  ROUTE:", route.join(" -> "), "-> answer");

console.log("\n--- export all 3 chains + offline verify ---");
for (const [n, f] of [[A,"export-A.json"],[B,"export-B.json"],[C,"export-C.json"]]) writeFileSync(`${DIR}/${f}`, JSON.stringify(await getAudit(n, n), null, 2));
const end = { A: await bal(A), B: await bal(B), C: await bal(C) };
console.log(`  credits — A:-${start.A-end.A}  B:-${start.B-end.B}  C:-${start.C-end.C}  (left A=${end.A} B=${end.B} C=${end.C})`);
const run = (a) => { try { return execSync(`node "${VERIFIER}" ${a}`, {cwd:DIR}).toString().trim(); } catch(e){ return "(err) "+(e.stdout?.toString()||e.message); } };
console.log("  A:", run("export-A.json"), "| B:", run("export-B.json"), "| C:", run("export-C.json"));
for (let i=0;i<visited.length-1;i++){ const p=visited[i].label[0], q=visited[i+1].label[0]; console.log(`  --cross ${p}-${q}:`, run(`--cross export-${p}.json export-${q}.json`)); }
console.log("\n=== D2 GATE: route visits 3 nodes; CHAIN OK x3; CROSS-ANCHOR OK on each traversed pair ===");
