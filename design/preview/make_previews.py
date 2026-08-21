#!/usr/bin/env python3
"""
Static preview builder.

These HTML files are not the app. They are hand-written mirrors of the real
markup that link the *real* apps/web/app/globals.css, so the design system can be
rendered and screenshotted without a Next build — useful for README shots, and
useful for catching a broken token or a mis-aligned ASCII grid without waiting
for a deploy.

If a class here does not exist in globals.css, the preview will look wrong, which
is exactly the feedback loop we want.

    python3 design/preview/make_previews.py
"""

import math
import pathlib

HERE = pathlib.Path(__file__).parent
CSS = "../../apps/web/app/globals.css"

RAMP = " .:-=+*#%@"

# A 5x7 cell font for the hero word. The app builds its mask the same way in
# components/ascii/field.ts; this is a standalone copy so the preview has no
# build step.
FONT = {
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "I": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "A": ["..#..", ".#.#.", "#...#", "#...#", "#####", "#...#", "#...#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
}


def word_mask(word, cols, rows):
    """Which cells sit inside the word. Centred, one blank column per letter."""
    glyph_w, glyph_h = 5, 7
    width = len(word) * (glyph_w + 1) - 1
    x0 = (cols - width) // 2
    y0 = (rows - glyph_h) // 2
    mask = set()
    for i, ch in enumerate(word):
        rowsrc = FONT.get(ch)
        if not rowsrc:
            continue
        for gy, line in enumerate(rowsrc):
            for gx, c in enumerate(line):
                if c == "#":
                    mask.add((x0 + i * (glyph_w + 1) + gx, y0 + gy))
    return mask


def hero(cols=118, rows=14, t=0.0):
    """One frame of the interference field, with the word burned brighter."""
    mask = word_mask("LIVEMARKETS", cols, rows)
    out = []
    for y in range(rows):
        line = []
        for x in range(cols):
            # Two travelling waves plus a slow radial term. Deterministic, so the
            # same frame renders identically every time.
            u = x / cols * math.pi * 6
            v = y / rows * math.pi * 3
            d = math.hypot(x - cols / 2, (y - rows / 2) * 2) / cols
            f = (
                math.sin(u + t) * 0.45
                + math.sin(v * 1.7 - t * 0.6) * 0.3
                + math.cos(d * 9 - t) * 0.25
            )
            level = ((f + 1) / 2) * 0.3  # background is texture, not content
            if (x, y) in mask:
                level = 0.92 + ((f + 1) / 2) * 0.08  # the word is the content
            idx = max(0, min(len(RAMP) - 1, int(level * (len(RAMP) - 1))))
            line.append(RAMP[idx])
        out.append("".join(line))
    return "\\n".join(out)


SHARD_DIAGRAM = """      one question              nineteen shards                 one settlement

                          ┌─ 0.05 ─┐ openYes  openNo  matched ┐
                          ├─ 0.10 ─┤ openYes  openNo  matched │
   "Boundary this  ───────┼─ 0.15 ─┤ openYes  openNo  matched │
    over?"                │   ⋮    │    ⋮       ⋮       ⋮     ├──▶  yes / no / void
                          ├─ 0.85 ─┤ openYes  openNo  matched │
                          ├─ 0.90 ─┤ openYes  openNo  matched │
                          └─ 0.95 ─┘ openYes  openNo  matched ┘

                          ┗━━━━━━ 19 concurrent matchTick() txs ━━━━━━┛"""


def ladder():
    """A depth ladder mirroring components/ascii/DepthLadder.tsx."""
    # tick -> (openYes, openNo, matched) in whole shares, shaped like a real book:
    # thin at the wings, deep either side of the implied price.
    shape = [
        (0, 12, 0), (0, 9, 0), (1, 8, 0), (2, 14, 1), (3, 11, 2),
        (6, 9, 4), (9, 7, 8), (14, 6, 13), (18, 4, 21), (23, 3, 26),
        (17, 2, 19), (11, 1, 12), (7, 2, 6), (4, 3, 3), (2, 5, 1),
        (1, 7, 0), (1, 9, 0), (0, 11, 0), (0, 13, 0),
    ]
    peak = max(max(y, n) for y, n, _ in shape) or 1
    width = 14
    rows = []
    for i, (y, n, m) in enumerate(shape):
        price = (i + 1) * 5
        ybar = "█" * round(y / peak * width)
        nbar = "█" * round(n / peak * width)
        mark = "◀" if i == 9 else " "
        rows.append(
            '<tr>'
            f'<td class="num yes" style="text-align:right">{ybar or "·"}</td>'
            f'<td class="num yes" style="text-align:right">{y or ""}</td>'
            f'<td class="num" style="text-align:center">0.{price:02d}{mark}</td>'
            f'<td class="num no">{n or ""}</td>'
            f'<td class="num no">{nbar or "·"}</td>'
            f'<td class="num muted" style="text-align:right">{m or "·"}</td>'
            '</tr>'
        )
    return "\\n".join(rows)


SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<link rel="stylesheet" href="__CSS__">
</head>
<body class="__THEME__">
__BODY__
</body>
</html>
"""


LANDING = """
<div class="plate">
  <header class="wrap" style="display:flex;align-items:center;justify-content:space-between;padding-block:var(--s5)">
    <div style="display:flex;align-items:center;gap:var(--s4)">
      <span class="label" style="letter-spacing:.28em;color:var(--fg)">LIVEMARKETS</span>
      <span class="badge">beta · monad testnet · test funds only</span>
    </div>
    <nav style="display:flex;gap:var(--s4);align-items:center">
      <span class="label">how it works</span>
      <span class="label">benchmark</span>
      <a class="btn" href="#">open the app</a>
    </nav>
  </header>

  <div class="wrap">
    <pre class="ascii halftone" aria-hidden="true" style="margin:0;color:var(--fg)">__HERO__</pre>
  </div>

  <section class="wrap" style="padding-block:var(--s7)">
    <p class="label">sixty seconds. one question. onchain.</p>
    <h1 class="display" style="font-size:var(--t-h1);margin:var(--s4) 0 var(--s5)">markets that live for a minute</h1>
    <p class="lead">A question opens. For forty-five seconds anyone can take a side at one of nineteen
      prices. Then it settles, and everyone gets paid in the same block. The order book is sharded by price, so all
      nineteen levels match at the same time instead of queueing behind each other.</p>
    <div style="display:flex;gap:var(--s3);margin-top:var(--s6)">
      <a class="btn" href="#">trade the live round</a>
      <a class="btn btn-ghost" href="#">read the contracts</a>
      <a class="btn btn-ghost" href="#">get test MON</a>
    </div>
  </section>

  <hr class="rule">

  <section class="wrap" style="padding-block:var(--s7)">
    <p class="label">how a round works</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s5);margin-top:var(--s5)">
      <div class="panel"><div class="panel-head"><span class="label">01 · open</span><span class="num">45s</span></div>
        <div class="panel-body prose">Buy YES or NO at any of nineteen prices, 0.05 to 0.95. Your collateral rests at
          that price and comes back if it never fills.</div></div>
      <div class="panel"><div class="panel-head"><span class="label">02 · match</span><span class="num">continuous</span></div>
        <div class="panel-body prose">A YES and a NO at the same price have posted exactly 1.00 between them — which is
          exactly what the pair pays out. Anyone can crank it and earn a cut.</div></div>
      <div class="panel"><div class="panel-head"><span class="label">03 · settle</span><span class="num">60s</span></div>
        <div class="panel-body prose">Winners take 1.00 per share minus 1%. VOID refunds both legs at the traded price
          and charges nothing at all.</div></div>
    </div>
  </section>

  <hr class="rule">

  <section class="wrap" style="padding-block:var(--s7)">
    <h2 class="display" style="font-size:var(--t-h2);margin:0 0 var(--s4)">The order book is sharded by price</h2>
    <p class="prose">One shared book is one contended slot: two people filling unrelated prices still write the same
      storage, so a parallel chain has to serialise them. Nineteen independent books do not collide, so nineteen
      transactions run at once.</p>
    <pre class="ascii ascii-selectable" style="margin-top:var(--s6);color:var(--fg-muted)">__SHARDS__</pre>
  </section>

  <hr class="rule">

  <section class="wrap" style="padding-block:var(--s7)">
    <p class="label">the benchmark</p>
    <div class="panel" style="margin-top:var(--s4)">
      <div class="panel-head"><span class="label">parallel vs sequential</span><span class="badge">not measured yet</span></div>
      <div class="panel-body prose">
        <p style="margin-top:0">No numbers here until someone runs them. <span class="num">npm run bench</span> fills
          all nineteen levels one at a time, then all at once, and writes the result into the page.</p>
        <p class="muted" style="margin-bottom:0">What is true without a benchmark, by reading the source: 19 ticks,
          4 storage slots per tick on the match path, 0 slots shared between ticks.</p>
      </div>
    </div>
  </section>

  <hr class="rule">

  <section class="wrap" style="padding-block:var(--s7)">
    <p class="label">who decides the outcome</p>
    <table class="table" style="margin-top:var(--s4)">
      <tr><td class="num">v1</td><td>single resolver key</td><td class="yes">live</td></tr>
      <tr><td class="num">v2</td><td>3-of-5 committee behind a multisig</td><td class="muted">next</td></tr>
      <tr><td class="num">v3</td><td>optimistic: propose, bond, challenge, finalise</td><td class="muted">planned</td></tr>
    </table>
    <p class="prose muted" style="margin-top:var(--s4)">Today one key settles every market. That is the real
      centralisation and the app says so on the page where it matters.</p>
  </section>

  <hr class="rule">

  <section class="wrap" style="padding-block:var(--s7);display:flex;gap:var(--s5);align-items:flex-end">
    <div style="flex:1">
      <p class="label">get the next question in your inbox</p>
      <input class="input" style="margin-top:var(--s3)" value="you@example.com">
    </div>
    <button class="btn">join the waitlist</button>
  </section>

  <hr class="rule">

  <footer class="wrap" style="padding-block:var(--s5);display:flex;justify-content:space-between">
    <span class="label">MIT · unaudited · testnet only</span>
    <span class="label">factory · source · @livemarkets</span>
  </footer>
</div>
"""


ROOM = """
<header class="wrap" style="display:flex;align-items:center;justify-content:space-between;padding-block:var(--s4);border-bottom:1px solid var(--line)">
  <div style="display:flex;align-items:center;gap:var(--s4)">
    <span class="label" style="letter-spacing:.28em;color:var(--fg)">LIVEMARKETS</span>
    <span class="badge">single resolver</span>
  </div>
  <nav style="display:flex;gap:var(--s4)"><span class="label">portfolio</span><span class="label">test MON</span></nav>
</header>

<main class="wrap" style="padding-block:var(--s6)">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s5)">
    <div>
      <p class="label">round 148 · open</p>
      <h1 class="display" style="font-size:var(--t-h2);margin:var(--s3) 0 0">Boundary this over?</h1>
    </div>
    <div style="text-align:right">
      <p class="label">closes in</p>
      <pre class="ascii" style="margin:var(--s2) 0 0;font-size:var(--t-h3);color:var(--fg)">00:27</pre>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:var(--s5);margin-top:var(--s6)">
    <div class="panel">
      <div class="panel-head">
        <span class="label">depth by price</span>
        <span class="num">implied <span class="yes">0.50</span></span>
      </div>
      <div class="panel-body">
        <table class="table" style="width:100%">
          <thead><tr>
            <th class="label" style="text-align:right">yes</th><th class="label" style="text-align:right">sz</th>
            <th class="label" style="text-align:center">price</th>
            <th class="label">sz</th><th class="label">no</th>
            <th class="label" style="text-align:right">matched</th>
          </tr></thead>
          <tbody>__LADDER__</tbody>
        </table>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:var(--s5)">
      <div class="panel">
        <div class="panel-head"><span class="label">your order</span><span class="num">0.50</span></div>
        <div class="panel-body">
          <div style="display:flex;gap:var(--s2)">
            <button class="btn btn-yes" style="flex:1">buy yes</button>
            <button class="btn btn-ghost" style="flex:1">buy no</button>
          </div>
          <p class="label" style="margin:var(--s5) 0 var(--s2)">shares</p>
          <input class="input" value="25">
          <div style="display:flex;gap:var(--s2);margin-top:var(--s2)">
            <button class="btn btn-ghost" style="flex:1">1</button>
            <button class="btn btn-ghost" style="flex:1">5</button>
            <button class="btn btn-ghost" style="flex:1">25</button>
            <button class="btn btn-ghost" style="flex:1">100</button>
          </div>
          <table class="table" style="width:100%;margin-top:var(--s5)">
            <tr><td class="label">cost</td><td class="num" style="text-align:right">12.500000 MON</td></tr>
            <tr><td class="label">max payout</td><td class="num" style="text-align:right">25.000000 MON</td></tr>
            <tr><td class="label">max profit</td><td class="num yes" style="text-align:right">+12.375000 MON</td></tr>
            <tr><td class="label">break even</td><td class="num" style="text-align:right">0.505</td></tr>
          </table>
          <button class="btn" style="width:100%;margin-top:var(--s4)">place order · one signature</button>
          <p class="label" style="margin-top:var(--s3)">1% fee on winnings only · void charges nothing</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><span class="label">crank</span><span class="badge">permissionless</span></div>
        <div class="panel-body prose">
          <p style="margin:0 0 var(--s3)">Nine levels are crossable right now. Matching them pays you 10% of the fee
            on whatever you match.</p>
          <button class="btn btn-ghost" style="width:100%">match this tick</button>
        </div>
      </div>
    </div>
  </div>

  <div class="panel" style="margin-top:var(--s5)">
    <div class="panel-head"><span class="label">your position</span><span class="num">balance 4.250000 MON</span></div>
    <div class="panel-body">
      <table class="table" style="width:100%">
        <thead><tr><th class="label">price</th><th class="label">side</th><th class="label" style="text-align:right">shares</th><th class="label" style="text-align:right">if it wins</th><th class="label"></th></tr></thead>
        <tbody>
          <tr><td class="num">0.45</td><td class="yes">yes</td><td class="num" style="text-align:right">18.000000</td><td class="num yes" style="text-align:right">+9.910000</td><td><button class="btn btn-ghost">cancel resting</button></td></tr>
          <tr><td class="num">0.60</td><td class="no">no</td><td class="num" style="text-align:right">6.000000</td><td class="num no" style="text-align:right">+3.564000</td><td><button class="btn btn-ghost">cancel resting</button></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</main>
"""


def build(name, title, theme, body):
    html = (
        SHELL.replace("__TITLE__", title)
        .replace("__CSS__", CSS)
        .replace("__THEME__", theme)
        .replace("__BODY__", body)
    )
    (HERE / name).write_text(html, encoding="utf-8")
    print(f"wrote {name} ({len(html):,} bytes)")


if __name__ == "__main__":
    build(
        "landing.html",
        "LiveMarkets — landing",
        "theme-paper",
        LANDING.replace("__HERO__", hero()).replace("__SHARDS__", SHARD_DIAGRAM),
    )
    build(
        "room.html",
        "LiveMarkets — trading room",
        "theme-ink",
        ROOM.replace("__LADDER__", ladder()),
    )
