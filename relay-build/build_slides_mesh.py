#!/usr/bin/env python3
"""Render mesh demo slides (1920x1080) -> PNG via Playwright. Same deck style as the
receipt-runtime video; mesh content, each slide carrying real testnet data."""
import pathlib
from playwright.sync_api import sync_playwright

OUT = pathlib.Path("/tmp/slides_mesh"); OUT.mkdir(parents=True, exist_ok=True)
CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;height:1080px;overflow:hidden;
  background:radial-gradient(1300px 850px at 34% 28%,#15213c 0%,#0b1124 46%,#070b16 100%);
  font-family:'Inter','Helvetica Neue','Liberation Sans',Arial,sans-serif}
.wrap{position:absolute;left:176px;top:50%;transform:translateY(-50%);max-width:1600px}
.title{font-size:84px;font-weight:800;color:#e9eef7;letter-spacing:1px;text-transform:uppercase;line-height:1.04;white-space:nowrap}
.title.sm{font-size:66px}
.bar{width:168px;height:7px;border-radius:4px;margin:28px 0 0;background:linear-gradient(90deg,#34e3a6,#1f9e78)}
.sub{font-size:42px;font-weight:400;color:#93a1b5;margin-top:42px;letter-spacing:.3px}
.hl{color:#34e3a6;font-weight:700}.red{color:#ff6a6a;font-weight:700}
.mono{display:inline-block;margin-top:56px;font-family:'JetBrains Mono','DejaVu Sans Mono','Liberation Mono',monospace;
  font-size:30px;color:#34e3a6;border:1px solid rgba(52,227,166,.28);background:rgba(18,28,46,.55);border-radius:10px;padding:20px 30px;letter-spacing:.5px}
.dim{color:#5f7488}
.foot{position:absolute;left:176px;bottom:64px;font-size:26px;color:#5f7488;font-family:'JetBrains Mono','DejaVu Sans Mono','Liberation Mono',monospace}
"""
def slide(title, sub, mono=None, sm=False, foot=None):
    t=f'<div class="title{" sm" if sm else ""}">{title}</div>'
    m=f'<div class="mono">{mono}</div>' if mono else ''
    f=f'<div class="foot">{foot}</div>' if foot else ''
    return f'<!doctype html><meta charset="utf-8"><style>{CSS}</style><div class="wrap">{t}<div class="bar"></div><div class="sub">{sub}</div>{m}</div>{f}'

SLIDES = {
 "00_title": slide("NO SINGLE POINT OF TRUST", 'a live mesh where agents verify <span class="hl">each other</span>'),
 "01_verified": slide("EVERY NODE VERIFIED", 'the receiver reads the sender&#39;s <span class="hl">unforgeable did:t3n</span> inside its own TEE', 'A &rarr; B &rarr; C   caller=<span class="hl">OK</span>   match=<span class="hl">OK</span>'),
 "02_random": slide("RANDOM, NOT BRIBABLE", 'the next verifier is pinned by the <span class="hl">chain hash</span> &mdash; gameable by no one', 'head&hellip;6d5bb002  &rarr;  B    <span class="dim">(recomputable by anyone)</span>'),
 "03_authority": slide("AUTHORITY IN THE PATH", 'revoke a grant and the very next action is <span class="hl">refused</span>', 'revoked  &rarr;  outcome=<span class="red">denied</span>  reason=no_active_grant'),
 "04_rewalk": slide("RE-WALK IT YOURSELF", 'download the chains, verify offline, <span class="hl">trust no node</span>', 'CHAIN OK &times;3  &middot;  CROSS-ANCHOR OK  &middot;  tamper &rarr; <span class="red">BROKEN</span>'),
 "05_inflight": slide("IN FLIGHT, NOT AFTER", 'not &ldquo;did it lie?&rdquo; &mdash; <span class="hl">&ldquo;may it take its next step?&rdquo;</span>', 'Terminal 3 cross-tenant: works from <span class="hl">any funded account</span>', sm=True),
 "06_close": slide("THE LAW AGENTS ACT UNDER", 'a live mesh, re-checkable in <span class="hl">30 seconds</span>', foot='github.com/Alexander-Sorrell-IT/on-the-record'),
}
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1920,"height":1080}, device_scale_factor=1)
    for name,html in SLIDES.items():
        pg.set_content(html); pg.wait_for_timeout(120); pg.screenshot(path=str(OUT/f"{name}.png")); print("wrote",name)
    b.close()
print("DONE", len(SLIDES), "mesh slides ->", OUT)
