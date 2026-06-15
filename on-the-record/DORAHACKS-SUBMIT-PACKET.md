# DoraHacks submission — paste-ready packet (On the Record)

Submit at: **https://dorahacks.io/hackathon/t3adkdevchallenge** → **Submit BUIDL**
(Log in first — your session is saved in `~/.creds-profile`.) Deadline **2026-06-22 23:59 GMT+8**; target submit **Jun 21**.

## ✅ Pre-flight (do these 2 first)
1. **Video link.** DoraHacks wants a URL, not a file. Upload `on-the-record/filmstrip-demo.mp4` to YouTube **(Unlisted)** and paste the link below. (Optional but recommended — the entry is *also* live/reproducible, so the video is supporting, not sole.)
2. **Repo is public** ✅ already: https://github.com/Alexander-Sorrell-IT/on-the-record

---

## Field-by-field (copy each into the BUIDL form)

**BUIDL Name:**
```
On the Record — the receipt runtime for AI agents
```

**Tagline / one-liner:**
```
Acting and producing tamper-evident evidence are one atomic transaction. Cross-anchored, keyless, and reproducible by you offline in 30 seconds.
```

**Track:** `Track 1 — Best Agent utilising Terminal 3 Agent Auth SDK`
*(Track-2 bug reports are filed separately as individual reports — see TRACK2-INDEX.md.)*

**Tags:** `ai, security, trust, agent, agentic, identity, infrastructure`

**Tech stack:** `Rust, WASM (wasm32-wasip2), TypeScript/Node, Ethereum (did:t3n), MCP (@modelcontextprotocol/sdk)`

**Source code (GitHub):**
```
https://github.com/Alexander-Sorrell-IT/on-the-record
```

**Demo video:** `<paste your YouTube unlisted link>`

**Live / demo link (optional):** the repo itself is the live demo — `node on-the-record/demo.mjs`

**Team:** Solo. "Looking for teammates": No.

**Contact / referrer email:** `codehunterextreme@gmail.com`

**Description (paste the full body):** use the contents of `on-the-record/DORAHACKS_SUBMISSION.md` verbatim. Short version if a summary box is needed:
```
On the Record is a compliance-native agent runtime where acting and producing the
evidence are ONE atomic in-enclave transaction — every agent action (and every
refusal) is born as a salted, hash-chained receipt inside a Terminal 3 TEE.

Proven on testnet (contracts 107/110/111): a funded cross-tenant act() writes a
chained receipt; revoking a grant makes the next act refuse itself AND records the
refusal in the same chain; two independently-claimed tenants cross-anchor each
other's chain heads; and a keyless Claude agent acts only through a real MCP custody
proxy (it never holds a key — verified, the key is in 0 shipped files).

Run it yourself in 30 seconds, no install, no network, no credits:
  node on-the-record/demo.mjs
  node on-the-record/verifier.mjs on-the-record/export.json        -> CHAIN OK
  node on-the-record/verifier.mjs --cross export-a2.json export-a3.json -> CROSS-ANCHOR OK
  open on-the-record/filmstrip.html   (tamper a cell -> watch it flip red)

SDK depth (the 40% axis): contracts.register, cross-tenant executeAndDecode,
contract-scoped map ACLs, executeControl control-plane seeding, in-enclave
calling_user_did / seq_no / cluster_timestamp_secs / kv_store / masked secrets,
did:t3n ETH auth, get-audit reads, and a real MCP stdio server.

Honest by design: tamper-EVIDENT not tamper-PROOF; cross-anchor proves the mechanism
on two accounts we control (full independence when third parties run anchors); we do
NOT claim "cluster-signed" (the SDK lacks the client read path — filed as a Track-2
finding). Provenance disclosed: forked from our earlier mesh-seller contract.
```

---

## Submit steps
1. Log in to DoraHacks (saved profile), open the hackathon, click **Submit BUIDL**.
2. Paste each field above. Upload a logo/cover if it asks (optional — a frame from `filmstrip-demo.mp4` works).
3. Paste the video link. Select Track 1. Add tags.
4. Review → **Submit**. You can edit after submitting, so submitting early (then refining) is safe.

## What still needs YOU
- The **YouTube link** for the video (your account).
- The **final Submit click** (your DoraHacks account).
Everything else is ready.
