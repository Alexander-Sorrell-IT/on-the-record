# On the Record — Demo Video Script (~3:00)

Shot-by-shot script for the demo recording. Every on-screen string below is
something `demo.mjs`, `verifier.mjs`, `render-filing.mjs`, or `agent-loop.mjs`
**actually prints** — verified by running them. Nothing here is mocked or
aspirational.

**The primary on-screen action is one command:** `node on-the-record/demo.mjs`
— the narrated, one-command offline walkthrough that runs the whole proof and
**exits 0**. It reuses the exported functions of `verifier.mjs` and
`render-filing.mjs` (no hashing reimplemented) against the real testnet-captured
exports. The individual `verifier.mjs` commands are kept verbatim in the
**recorder appendix** below for tight, per-section cutaways.

**Format conventions**
- **ON SCREEN** = what the viewer sees (terminal command + its real output, or a code/file view).
- **NARRATION** = voiceover, ~2 sentences per beat, read at a calm pace.
- All commands are run from the repo root. No network, no credits, no SDK calls — pure Node.
- No names. Tenants are referred to as "Account 2 / Account 3" or "tenant A / tenant B".

Total target runtime ~3:00. Per-beat timings are budgets, not hard cuts.

---

## PRIMARY ACTION — one command, narrated (drives the whole recording)

**ON SCREEN:** A single command typed at the repo root, then its output scrolls:

```bash
node on-the-record/demo.mjs
```

It prints a five-section narrated walkthrough and exits `0`. The literal section
headers it prints, in order:

```
ON THE RECORD — offline proof walkthrough
Pure Node. No network, no testnet, no credits. Reusing verifier.mjs.

  1) ACT + EVIDENCE ARE ONE TRANSACTION
  2) TAMPER-EVIDENT
  3) NO SINGLE POINT OF FAILURE
  4) THE AGENT HOLDS NO KEYS
  5) THE FILING
```

Key literal lines it prints along the way (verbatim — capture these on screen):

```
verifier.mjs export.json  ->  CHAIN OK 2 rows
verify tampered copy      ->  BROKEN AT seq=29263
re-verify original        ->  CHAIN OK 2 rows  (file untouched; tamper was in-memory)
  ->  CROSS-ANCHOR OK
      A head 4e9ebc4e1106…a16394660619 bound in B (A2 seals A3's real head)
      B head c4acbe4985ff…3a7341268411 bound in A (A3 seals A2's real head)
  cross-anchor against A    ->  CROSS-ANCHOR MISMATCH
verifier.mjs export-agent.json  ->  CHAIN OK 5 rows
evidence-hash citations in filing: 2 (one per receipt row — every line is traceable)
```

And the closing card it prints:

```
  A released, offline-reproducible receipt runtime: every grant-checked
  act — including its refusal — is sealed into one tamper-evident,
  cross-anchored, keyless-agent-safe hash-chain, and you just reproduced
  the entire proof with no network, no testnet, and no credits.
```

**NARRATION:**
> One command reproduces the entire entry offline. No network, no testnet, no
> credits — it reuses the verifier's own hashing against real testnet-captured
> receipts and exits clean. Everything that follows is just this same run,
> slowed down section by section so you can see each link in the chain.

The beats below are the per-section breakdown of exactly what `demo.mjs` does —
shoot them as cutaways over the single run above, or run the individual
`verifier.mjs` commands from the recorder appendix for tighter framing. Both
paths show the same literal output.

---

## COLD OPEN — silent (0:00–0:10) [optional]

**ON SCREEN:** Black screen. A single terminal line types itself out and runs, no voice:

```bash
node verifier.mjs export.json
```

Output appears in green:

```
CHAIN OK 2 rows
```

Hold one beat. Then one byte of `export.json` is flipped in an editor (visible diff: a single character in an `action` field changes), the same command re-runs, and the output turns red:

```
BROKEN AT seq=29270
```

Cut to title card: **On the Record — the receipt IS the action.**

**(No narration. The whole pitch — verifiable, then provably tamper-evident — lands in ten silent seconds.)**

---

## BEAT 0 — The reframe (0:10–0:35)

**ON SCREEN:** Title card fades to the README top section ("acting and producing tamper-evident evidence of the act are one atomic in-enclave transaction"). Cursor rests on that line.

**NARRATION:**
> Everyone else built an agent that does a trick. This is the runtime where acting and proving are one transaction — released, and reproducible by you, right now. There's no separate logging step that can drift, lie, or be skipped: the receipt *is* the action, and everything else here is derived from that one substrate.

---

## BEAT 1 — Act + evidence are one transaction (0:35–1:05)

**ON SCREEN:** Open `export.json` and scroll the two rows. Highlight the ALLOWED row (`seq 29263`, `action: transfer:invoice-7782`, `outcome: allowed`, `masked_secret: sk_l…****…2a7c`, `prev_hash` = 64 zeros). Then highlight the DENIED row (`seq 29270`, `outcome: denied`, `reason: no_active_grant`, `prev_hash` = the previous row's hash). Run:

```bash
node verifier.mjs export.json
```
```
CHAIN OK 2 rows
```

**NARRATION:**
> A single governed verb, `record-action`, does the work and writes the receipt in one in-enclave step. Here the grant allowed `seq 29263`, the grant was revoked, and `seq 29270` was *denied* — `reason: no_active_grant` — and that refusal is chained directly onto the act before it. The refusal is itself a permanent receipt; you can't keep the convenient allowed row and quietly drop the inconvenient denied one.

---

## BEAT 2 — Tamper-evident: green to red (1:05–1:35)

**ON SCREEN:** Split view. Left: editor on `export.json`. Right: terminal. Change a single character inside any row's `action` (do NOT recompute the hash). Save. Run:

```bash
node verifier.mjs export.json
```
```
BROKEN AT seq=29270
```

Undo the edit, save, re-run — back to green `CHAIN OK 2 rows`. Then run the suite:

```bash
node verifier.test.mjs
```
```
ALL TESTS PASSED
```

**NARRATION:**
> The verifier recomputes every receipt hash from nothing but a public salt and SHA-256, and tells you the exact `seq` where continuity breaks. Edit one byte and it reports `BROKEN AT seq=29270`; restore it and it's `CHAIN OK` again — eight checks pass, including two negative cases that *must* fail and do.

---

## BEAT 3 — No single point of failure: cross-anchor (1:35–2:10)

**ON SCREEN:** Show `export-a2.json` (Account 2, tenant A) and `export-a3.json` (Account 3, tenant B) side by side. Highlight that A2's row seals A3's real head `c4ac…8411` as `peer_head`, and A3's seal-row carries A2's real head `0092…e07a` as its `peer_head`. Then run:

```bash
node verifier.mjs --cross export-a2.json export-a3.json
```
```
CROSS-ANCHOR OK (A head=4e9ebc4e11067ccc3f6fe790bdffb331b0bf0abdf50cce648008a16394660619 bound in B; B head=c4acbe4985ffbf61b47698fe56171d01eb2fcea3770b540104c23a7341268411 bound in A)
```

**NARRATION:**
> A cross-anchor is just another receipt: a `seal` row, hashed through the exact same path. Two separately-claimed tenants each seal the other's real chain head into their own, so neither can rewrite its history without breaking the other's anchor — the verifier confirms each chain is intact *and* that each seal anchors a real head the peer genuinely exposed. Both directions bind: `CROSS-ANCHOR OK`.

---

## BEAT 4 — The keyless agent through the MCP proxy (2:10–2:40)

**ON SCREEN:** Briefly show two source files: `agent-loop.mjs` (the line that scrubs `T3N_API_KEY*` from `process.env` and asserts none remain) and `proxy/custody.mjs` (note the closure with no key getter). Then run the captured-style command:

```bash
env -u T3N_API_KEY -u T3N_API_KEY_2 -u T3N_API_KEY_3 -u T3N_KEY -u ANTHROPIC_API_KEY \
  node agent-loop.mjs
```

On-screen result (from the captured run) — `agent-loop.mjs` prints an
`==== AGENT-LOOP RESULT ====` JSON object; the key fields to highlight:

```
"acts_through_proxy": 3,
"verifier_cli": "CHAIN OK 5 rows",
"agent_holds_no_key": true
```

Cut to `export-agent.json`: highlight the three new agent rows — `load-policy` (29680), `process-batch:invoices` (29686), `flag-anomaly:txn-4471` (29692) — each `prev_hash` matching the head the agent had just read. Confirm:

```bash
node verifier.mjs export-agent.json
```
```
CHAIN OK 5 rows
```

**NARRATION:**
> The agent holds no key — it scrubs the environment and asserts nothing's left, and its only path to the chain is a real MCP stdio server that custodies the key alone, behind a closure with no getter. It ran a gather-decide-act loop and appended three chained rows; the live trail and the offline export both verify `CHAIN OK 5 rows`.

---

## BEAT 5 — The filing (2:40–2:55)

**ON SCREEN:** Run the renderer:

```bash
node render-filing.mjs export.json filing.md
```
```
FILING RENDERED -> /media/phantomcore/AI_DRIVE/hackathons/terminal 3 part 2/on-the-record/filing.md
```

Open `filing.md`: scroll the header (`Verification status | CHAIN OK (2 rows, recomputed client-side)`, chain head `22eef927…d61a`) and the per-entry cited hashes.

**NARRATION:**
> One command turns a verified chain into a regulator-style audit filing where every entry cites its own evidence hash. The renderer reuses the verifier and *refuses to render a broken chain* — a filing only exists over a record that checks out.

---

## CLOSE — Honest guarantee + honest limits (2:55–3:10)

**ON SCREEN:** Full-screen text card, three lines fading in:

```
GUARANTEE — category + completion:
a released, offline-reproducible receipt runtime where acting and proving are one transaction.

HONEST LIMITS:
• Tamper-EVIDENT, not tamper-PROOF — modification is detected, not prevented.
• Cross-anchor shown as a MECHANISM, with two accounts we control;
  full independence holds when third parties run the anchors.
• No "cluster-signed" claim — the SDK read path is absent, so we don't assert it (filed as Track-2 #1).
```

**NARRATION:**
> The guarantee is a category, not a percentage: a receipt runtime that's actually built and that you can reproduce offline. And the limits, stated plainly — it's tamper-evident, not tamper-proof; the cross-anchor is the mechanism demonstrated with two accounts we control; and we make no cluster-signed claim, because the read path for that isn't there. Open the repo and break it yourself.

**ON SCREEN (final hold):** the cold-open command again, green:

```
CHAIN OK 2 rows
```

Fade out.

---

## Appendix — exact commands & their real output (for the recorder)

The **primary** action is command 0 — the one-command narrated walkthrough.
Commands 1–7 are the individual `verifier.mjs` / renderer / agent invocations
`demo.mjs` is built from; use them for tight per-section cutaways. Run from the
repo root (`on-the-record/`). These are the literal strings to capture:

| # | Command | Output (verbatim) |
|---|---|---|
| 0 | **`node demo.mjs`** (the primary on-screen action) | five narrated sections (`1) ACT + EVIDENCE…` … `5) THE FILING`), then the closing card; **exits 0** |
| 1 | `node verifier.mjs export.json` | `CHAIN OK 2 rows` |
| 2 | (flip one byte, no rehash) `node verifier.mjs export.json` | `BROKEN AT seq=<the row you touched>` (e.g. `BROKEN AT seq=29270`; `demo.mjs` flips seq 29263 in-memory and prints `BROKEN AT seq=29263`) |
| 3 | `node verifier.test.mjs` | `ALL TESTS PASSED` (8 checks: 3 positive, 2 negative, structure) |
| 4 | `node verifier.mjs --cross export-a2.json export-a3.json` | `CROSS-ANCHOR OK (A head=4e9e…0619 bound in B; B head=c4ac…8411 bound in A)` |
| 5 | `node verifier.mjs export-agent.json` | `CHAIN OK 5 rows` |
| 6 | `node render-filing.mjs export.json filing.md` | `FILING RENDERED -> …/filing.md` |
| 7 | keyless agent (keys unset) `node agent-loop.mjs` | `==== AGENT-LOOP RESULT ====` JSON object incl. `"acts_through_proxy": 3`, `"verifier_cli": "CHAIN OK 5 rows"`, `"agent_holds_no_key": true` |

Recording notes:
- Command 0 (`demo.mjs`) is the headline shot: it runs commands 1–6's logic in one
  pass with narration and exits 0. Commands 1–7 are for cutaways or an
  offline-only recording where you'd rather show each step in isolation.
- For beat 2, keep the byte-flip visible (an editor diff sells it more than a hex dump).
  `demo.mjs` does the flip in-memory (leaving the file untouched) and reports the
  exact `seq` of the byte it changed (`29263`); a manual edit reports whichever
  row you touch.
- Hash strings are long; on-screen, abbreviate to `4e9e…0619` (A's head) / `0092…e07a` (A2's row-0, sealed by A3) / `c4ac…8411` (A3's head) / `22ee…d61a` for readability, but the verifier prints them in full (fine to show full once, then crop).
- The keyless run uses the local `claude` CLI as its brain and needs the proxy/SDK present; if recording offline-only, show the captured result line and `export-agent.json` instead of a live agent run — the verifier still proves it offline via command 5 (and `demo.mjs` section 4 shows the same `CHAIN OK 5 rows`).
