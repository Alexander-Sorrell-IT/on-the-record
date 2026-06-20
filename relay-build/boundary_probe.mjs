// BETTER ADVERSARIAL PROOF — pin the exact boundary of the 10k credit floor with ONE sub-10k account.
// Claim under test: the >=10,000 floor gates REGISTER / tenant.claim, but NOT cross-tenant INVOKE.
// If true: the same low-balance account (a) succeeds at a PAID cross-tenant invoke, and
//          (b) is rejected with 403 required=10000 when it tries to REGISTER (no charge).
import {
  T3nClient, TenantClient, loadWasmComponent, setEnvironment,
  createEthAuthInput, eth_get_address, metamask_sign, getNodeUrl, getScriptVersion,
} from "@terminal3/t3n-sdk";
import { readFile } from "fs/promises";
const TAIL = "on-the-record";
const WASM = decodeURIComponent(new URL("../terminal3-agent-mesh/contracts/on-the-record/target/wasm32-wasip2/release/on_the_record.wasm", import.meta.url).pathname);
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
  return {...node, bal:(await c.getUsage()).balance.available};
}
const bal=async n=>(await n.c.getUsage()).balance.available;

const C = await connect(process.env.T3N_API_KEY,  "C(acct1)");   // sub-10k account under test
const A = await connect(process.env.T3N_API_KEY_3, "A(acct3)");  // host for the invoke
console.log(`caller C balance=${C.bal}  (sub-10k? ${C.bal<10000})\n`);

// (a) PAID cross-tenant INVOKE from the sub-10k account
const a0=await bal(C); let inv,invErr=null;
try{ inv=await C.c.executeAndDecode({script_name:A.script,script_version:A.version,function_name:"record-action",
       input:{action:`boundary-probe: x-tenant invoke @${C.bal}cr`}}).then(decode); }catch(e){ invErr=e?.message||String(e); }
const a1=await bal(C);
console.log(`(a) INVOKE  : ${invErr?`FAILED -> ${invErr}`:`outcome=${inv?.outcome} caller=${(inv?.caller_did||"").slice(0,22)}.. charged=${a0-a1}cr`}`);

// (b) REGISTER attempt from the SAME sub-10k account (throwaway tail so the real contract is untouched)
const t=new TenantClient({environment:"testnet",t3n:C.c,tenantDid:C.didStr,baseUrl:getNodeUrl()});
const b0=await bal(C); let regOk=false, regErr=null;
try{ const r=await t.contracts.register({tail:"floor-probe",version:"0.1.0",wasm:await readFile(WASM)}); regOk=true; regErr=`UNEXPECTEDLY SUCCEEDED contract_id=${r.contract_id}`; }
catch(e){ regErr=e?.message||String(e); }
const b1=await bal(C);
const floorOnReg = !regOk && /required=10000|10000|InsufficientCredit/i.test(regErr);
console.log(`(b) REGISTER: ${regOk?regErr:`REJECTED -> ${regErr.slice(0,80)}`}  (charged=${b0-b1}cr)`);

console.log(`\n=== BOUNDARY VERDICT ===`);
const invokeOk = !invErr && inv?.outcome==="allowed" && C.bal<10000;
console.log(`invoke sub-10k works : ${invokeOk}`);
console.log(`register is 10k-gated: ${floorOnReg}`);
console.log(invokeOk && floorOnReg
  ? `PROVEN: the >=10k floor gates REGISTER but NOT cross-tenant INVOKE (same ${C.bal}cr account: invoke allowed, register required=10000).`
  : `INCONCLUSIVE: invokeOk=${invokeOk} floorOnReg=${floorOnReg} regErr="${regErr?.slice(0,120)}"`);
