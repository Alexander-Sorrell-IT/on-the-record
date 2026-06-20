// D3 adversarial beats: prove the mesh is tamper-evident + authority is enforced in-path.
import fs from "fs";
import { execSync } from "child_process";
import { T3nClient, TenantClient, loadWasmComponent, setEnvironment, createEthAuthInput, eth_get_address, metamask_sign, getNodeUrl, getScriptVersion } from "@terminal3/t3n-sdk";

const DIR = decodeURIComponent(new URL(".", import.meta.url).pathname);
const V = decodeURIComponent(new URL("../on-the-record/verifier.mjs", import.meta.url).pathname);
const run = (a) => { try { return execSync(`node "${V}" ${a}`, {cwd:DIR}).toString().trim(); } catch(e){ return "(err) "+(e.stdout?.toString()||e.message); } };
function decode(o){ if(o==null)return null; if(typeof o==="object"&&!Array.isArray(o)&&!(o instanceof Uint8Array))return o; if(typeof o==="string"){try{return JSON.parse(o)}catch{return o}} try{return JSON.parse(Buffer.from(Array.isArray(o)?Uint8Array.from(o):o).toString("utf8"))}catch{return o} }

console.log("=== BEAT 1: TAMPER — flip ONE byte in a row, no rehash -> caught ===");
console.log("  clean A     :", run("export-A.json"));
const A = JSON.parse(fs.readFileSync(`${DIR}/export-A.json`,"utf8"));
const tamp = JSON.parse(JSON.stringify(A));
const ri = tamp.rows.findIndex(r => r.action && r.action.length > 5);
const before = tamp.rows[ri].action;
tamp.rows[ri].action = before.slice(0,4) + (before[4] === "z" ? "q" : "z") + before.slice(5);
fs.writeFileSync(`${DIR}/_tampered-A.json`, JSON.stringify(tamp, null, 2));
console.log(`  tampered row seq=${tamp.rows[ri].seq} action "${before.slice(0,14)}.." -> "${tamp.rows[ri].action.slice(0,14)}.."`);
console.log("  tampered A  :", run("_tampered-A.json"));

console.log("\n=== BEAT 2: CROSS-ANCHOR on a pair NEVER mutually sealed (route was A->B->C, so A&C never sealed each other) ===");
console.log("  --cross A-B (real binding):", run("--cross export-A.json export-B.json"));
console.log("  --cross A-C (no binding)  :", run("--cross export-A.json export-C.json"));

console.log("\n=== BEAT 3 (testnet): revoke a peer's grant -> its in-path action is REFUSED and recorded ===");
setEnvironment("testnet");
const wasm = await loadWasmComponent();
async function connect(key){ const pk=key.startsWith("0x")?key:`0x${key}`; const a=eth_get_address(pk);
  const c=new T3nClient({wasmComponent:wasm,handlers:{EthSign:metamask_sign(a,undefined,pk)}}); await c.handshake();
  const did=(await c.authenticate(createEthAuthInput(a))).value; const tid=did.slice("did:t3n:".length);
  const script=`z:${tid}:on-the-record`; const ver=await getScriptVersion(getNodeUrl(),script).catch(()=>"0.1.0"); return {c,did,tid,script,ver}; }
const host = await connect(process.env.T3N_API_KEY_3);   // host A (acct3)
const peer = await connect(process.env.T3N_API_KEY_2);   // peer B (acct2)
const t = new TenantClient({environment:"testnet",t3n:host.c,tenantDid:host.did,baseUrl:getNodeUrl()});
const setGrant = (v)=>t.executeControl("map-entry-set",{map_name:t.canonicalName("policy"),key:`grant:${peer.did}`,value:v});
const recIntoHost = (act)=>peer.c.executeAndDecode({script_name:host.script,script_version:host.ver,function_name:"record-action",input:{action:act}}).then(decode);
await setGrant("revoked"); console.log("  revoked B's grant on A's host");
const denied = await recIntoHost("relay:hop from=B (revoked - expect DENY)");
console.log("  B->A while revoked row:", JSON.stringify(denied).slice(0,200));
console.log(`  GATE: outcome=${denied?.outcome} reason=${denied?.reason} -> ${denied?.outcome==="denied" ? "REFUSAL-AS-RECEIPT OK (authority enforced in-path)" : "UNEXPECTED"}`);
await setGrant("active"); console.log("  restored B's grant on A's host");
console.log("\n=== D3 step1 GATE: TAMPER->BROKEN, A-C not OK, revoked->denied ===");
