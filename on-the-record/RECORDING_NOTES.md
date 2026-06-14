# Recording notes — demo artifacts

This folder ships **three** demo artifacts produced offline (no network, no testnet,
no credits). All were generated with tooling already present on this machine — nothing
heavy was installed.

## What was produced

| Artifact | What it shows | How it was made |
|---|---|---|
| `filmstrip-demo.mp4` (497 KB, H.264, 1280x800, ~12 s) | The interactive integrity toy: GREEN **CHAIN OK 2 rows** → tamper an action cell → RED **BROKEN AT seq=29263** → reset → GREEN again. The browser recomputes every hash with pure JS and agrees with `verifier.mjs`. | Playwright (Python) drove `filmstrip.html` and recorded it; `ffmpeg` transcoded webm→mp4. |
| `filmstrip-demo.webm` (777 KB, VP8) | Same content, native Playwright recording. | Playwright (Python) `record_video`. |
| `demo.cast` (asciinema v2) | The full `node demo.mjs` CLI walkthrough captured as a terminal cast. | `asciinema rec`. NOTE: `demo.mjs` prints everything instantly (no inter-line delays), so the cast's real duration is ~0.1 s — it flashes by on replay. Good as a record of output; **not** ideal to narrate against as-is. |
| `demo-transcript.txt` (117 lines) | Plain-text transcript of the same CLI walkthrough. | `node demo.mjs > demo-transcript.txt`. |

**The primary watchable artifact for a judge is `filmstrip-demo.mp4`.** Verified frame-by-frame:
the green→red→green transition is really in the file (RED frame reads `BROKEN AT seq=29263`,
the first row whose hash breaks after tampering).

## Re-record the screen video (with your own narration) — ~2 minutes

The recorder script is checked in. Re-run it any time:

```bash
cd "on-the-record"
/home/phantomcore/PhantomCore/PhantomCore/bin/python3 record-filmstrip.py
# -> writes filmstrip-demo.webm
ffmpeg -y -i filmstrip-demo.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an filmstrip-demo.mp4
```

`record-filmstrip.py` uses the chromium already installed under
`~/.cache/ms-playwright` (no `playwright install` needed). To slow it down or change
the pauses for narration, edit the `page.wait_for_timeout(...)` values in the script.

### To narrate live instead of using the automated pacing
Just open the toy in any browser and screen-record yourself:

```bash
xdg-open "on-the-record/filmstrip.html"   # or drag the file into a browser
# Record your screen with OBS / your OS recorder while you:
#   1. point at the GREEN "CHAIN OK"
#   2. click an "action" cell, type a new value, press Enter -> light goes RED "BROKEN AT seq=..."
#   3. click "Reset to embedded chain" -> back to GREEN
```

## Re-record / re-render the CLI cast

```bash
cd "on-the-record"
asciinema rec --overwrite -c "node demo.mjs" --title "On the Record" demo.cast
asciinema play demo.cast          # local replay
# To upload / share:  asciinema upload demo.cast
```

To turn the cast into a GIF you'd need `agg` (not installed here):
`agg demo.cast demo.gif`. Skipped to avoid a heavy install.

## Secret hygiene

Scanned every artifact: no real T3N private keys (the `.env` Account1/2/3 keys),
no raw `sk_` secrets, no `T3N_API_KEY=0x<64hex>` assignments appear in
`filmstrip-demo.mp4/.webm`, `demo.cast`, `demo-transcript.txt`, or `record-filmstrip.py`.
The only `sk_…` strings present are the intentionally **masked** demo values
(`sk_l…****…2a7c`), which are the point of the secret-masking demonstration.
