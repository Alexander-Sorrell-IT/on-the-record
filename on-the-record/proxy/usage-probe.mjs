// One-shot credit-floor probe. Sources Account 3's key from the project .env
// (the custody side, NOT the agent), reads getUsage via custody, prints the
// balance as JSON, exits. Used by agent-loop.mjs for the post-run credit-floor
// check WITHOUT putting a key into the agent process.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makeCustody } from "./custody.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(HERE, "..", "..", ".env");
const txt = readFileSync(envPath, "utf8");
const m = txt.match(/^\s*T3N_API_KEY_3\s*=\s*(.+?)\s*$/m);
const key = m ? m[1].replace(/^['"]|['"]$/g, "") : null;
if (!key) { console.error("usage-probe: no T3N_API_KEY_3 in .env"); process.exit(1); }

const custody = await makeCustody({ key });
const balance = await custody.usage();
console.log(JSON.stringify({ balance }));
process.exit(0);
