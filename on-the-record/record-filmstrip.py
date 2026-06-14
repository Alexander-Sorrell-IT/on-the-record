#!/usr/bin/env python3
"""
Record filmstrip.html to a video via Playwright (Python).

Shows the interactive integrity toy:
  1. Loads the embedded refusal chain -> integrity light is GREEN "CHAIN OK".
  2. Tampers with an action cell (edits "transfer:invoice-7782") -> light flips
     RED "BROKEN AT seq=...", exactly mirroring `node verifier.mjs`.
  3. Resets back to GREEN "CHAIN OK".

No network. Uses the chromium already installed under ~/.cache/ms-playwright.
Output: filmstrip-demo.webm  (Playwright records webm natively).

Usage:
  /home/phantomcore/PhantomCore/PhantomCore/bin/python3 record-filmstrip.py
"""
import os
import shutil
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
HTML = HERE / "filmstrip.html"
REC_DIR = HERE / ".rec"
OUT = HERE / "filmstrip-demo.webm"
W, H = 1280, 800


def main():
    if not HTML.exists():
        print(f"missing {HTML}", file=sys.stderr)
        sys.exit(1)
    REC_DIR.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": W, "height": H},
            record_video_dir=str(REC_DIR),
            record_video_size={"width": W, "height": H},
        )
        page = ctx.new_page()
        page.goto(HTML.as_uri(), wait_until="load")

        light_label = page.locator("#lightLabel")
        light = page.locator("#light")

        # 1) GREEN — chain verified in-browser.
        light_label.wait_for(state="visible", timeout=10000)
        page.wait_for_function(
            "document.getElementById('lightLabel').textContent.trim() === 'CHAIN OK'",
            timeout=10000,
        )
        page.wait_for_timeout(2500)  # let the judge read "CHAIN OK / 2 rows"

        # 2) TAMPER — edit the first action cell, blur to commit.
        action = page.locator(".v.action").first
        action.scroll_into_view_if_needed()
        page.wait_for_timeout(800)
        action.click()
        page.wait_for_timeout(500)
        # Select-all then type a tampered value (beginEdit already selects contents,
        # but be explicit so this is deterministic).
        page.keyboard.press("Control+A")
        page.wait_for_timeout(300)
        page.keyboard.type("transfer:invoice-9999", delay=90)
        page.wait_for_timeout(500)
        # Commit by pressing Enter (blurs -> commit -> render -> light flips).
        page.keyboard.press("Enter")

        # 3) RED — verifier mismatch surfaced.
        page.wait_for_function(
            "document.getElementById('lightLabel').textContent.trim() === 'BROKEN'",
            timeout=10000,
        )
        page.wait_for_timeout(2800)  # hold on RED "BROKEN AT seq=..."

        # 4) RESET — back to GREEN to prove it's the data, not a trick.
        page.locator("#resetBtn").click()
        page.wait_for_function(
            "document.getElementById('lightLabel').textContent.trim() === 'CHAIN OK'",
            timeout=10000,
        )
        page.wait_for_timeout(2000)

        video = page.video
        ctx.close()  # finalizes the webm
        browser.close()
        if video:
            src = video.path()
            shutil.move(src, OUT)
    shutil.rmtree(REC_DIR, ignore_errors=True)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
