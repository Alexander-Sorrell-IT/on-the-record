// Settle it: can a SUB-10k-credit account make a PAID cross-tenant invoke?
// caller = C (acct1, the low-balance account); host = A (acct3). One record-action.
import {
  T3nClient, TenantClient, loadWasmComponent, setEnvironment,
  createEthAuthInput, eth_get_address, metamask_sign, getNodeUrl, getScriptVersion,
} from "@terminal3/t3n-sdk";
const TAIL = "on-the-record";
setEnvironment("testnet");
const wasm = await loadWasmComponent();
function decode(o){ if(o==null)return null; if(typeof o==="object"&&!Array.isArray(o)&&!(o instanceof Uint8Array))return o;
  if(typeof o==="string"){try{return JSON.parse(o)}catch{return o}} try{return JSON.parse(Buffer.from(Array.isArray(o)?Uint8Array.from(o):o).toString("utf8"))}catch{return o} }
async function connect(key,label){
  const pk=key.startsWith("0x")?key:`0x${key}`; const address=eth_get_address(pk);
  const c=new T3nClient({wasmComponent:wasm,handlers:{EthSign:metamask_sign(address,undefined,pk)}}); await c.handshake();
  const didStr=(await c.authenticate(createEthAuthInput(address)))?.value; const tid=didStr.slice("did:t3n:".length);
  const node={c,didStr,tid,script:`z:${tid}:${TAIL}`,version:null,label};
  node.version=await getScriptVersion(getNodeUrl(),node.script).catch(()=>null);
  const bal=(await c.getUsage()).balance.available;
  console.log(`[${label}] did=${didStr.slice(0,30)}.. ver=${node.version} balance=${bal}`);
  return {...node, bal};
}
const bal=async n=>(await n.c.getUsage()).balance.available;

const C = await connect(process.env.T3N_API_KEY,   "C(acct1 low)");   // the caller under test
const A = await connect(process.env.T3N_API_KEY_3,  "A(acct3 host)");  // the host

console.log(`\nFLOOR QUESTION: caller C balance=${C.bal} (under 10000? ${C.bal<10000}). Attempting PAID cross-tenant record-action C->A ...`);
const c0 = await bal(C);
let row, err=null;
try {
  row = await C.c.executeAndDecode({ script_name:A.script, script_version:A.version,
    function_name:"record-action", input:{ action:`subfloor-probe: paid x-tenant invoke from ${C.bal}cr caller` } }).then(decode);
} catch(e){ err = e?.message || String(e); }
const c1 = await bal(C);

if (err){ console.log(`RESULT: invoke FAILED -> ${err}`);
  console.log(err.includes("10000")||err.includes("required") ? "VERDICT: FLOOR APPLIES TO INVOKE (claim is FALSE)" : "VERDICT: failed for another reason (not a funding floor)"); }
else {
  console.log(`RESULT row: outcome=${row?.outcome} caller_did=${(row?.caller_did||"").slice(0,30)}.. seq=${row?.seq}`);
  console.log(`caller balance ${c0} -> ${c1} (delta ${c0-c1} credits)`);
  const ok = row?.outcome==="allowed" && row?.caller_did===C.didStr && c0<10000 && c0>c1;
  console.log(ok ? `VERDICT: NO 10k FLOOR — a ${c0}-credit account made a PAID cross-tenant invoke (stamped caller=C, paid ${c0-c1}cr). CLAIM PROVEN.`
                 : `VERDICT: inconclusive (outcome=${row?.outcome}, callerMatch=${row?.caller_did===C.didStr}, sub10k=${c0<10000}, paid=${c0>c1})`);
}
