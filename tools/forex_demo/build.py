"""Rebuild the portfolio's Forex demo (client/demo/forex) from the latest FX-App-Python Prototype edition.

    python tools/forex_demo/build.py <FX-App-Python checkout> [<output folder>]

Copies Events_System_Test/web (the browser-only Prototype) and turns it into the public "Demo Bank" demo:
no Centenary branding or logo files, the neutral Universal-edition logo and colours, six demo users (one
Inputter, Authoriser, Treasury Officer and Exchange Control officer, and two Administrators), no "Load test
data" button, and notes that people's names are made up. Every edit must apply exactly; if the upstream
code has changed so that one doesn't, or any Centenary text is left, the build stops with an error instead
of publishing something wrong. Used by .github/workflows/sync-demos.yml and runnable by hand.
"""
import os
import re
import shutil
import sys

FX = sys.argv[1] if len(sys.argv) > 1 else os.path.join("..", "Events_System", "FX-App-Python")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join("client", "demo", "forex")
SRC = os.path.join(FX, "Events_System_Test", "web")
UNI = os.path.join(FX, "Events_System_Universal", "web", "brand")

REMOVED_USERS = {"u_chiko": "u_grace", "u_tiya": "u_grace", "u_chisomo": "u_james", "u_kettie": "u_james"}


def fail(msg):
    sys.exit("Forex demo build stopped: " + msg)


def edit(rel, pairs, count=1):
    """Replace each old text exactly `count` times (None = at least once)."""
    path = os.path.join(OUT, rel)
    text = open(path, encoding="utf-8").read()
    for old, new in pairs:
        n = text.count(old)
        if (count is None and n == 0) or (count is not None and n != count):
            fail(f"{rel}: expected {'some' if count is None else count} of {old[:70]!r}, found {n}")
        text = text.replace(old, new)
    open(path, "w", encoding="utf-8", newline="").write(text)


def main():
    if not os.path.isdir(SRC):
        fail(f"no Prototype web folder at {SRC}")
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(SRC, OUT, ignore=lambda d, names: [n for n in names if n.lower().startswith("centenary")])
    for f in ("logo.svg", "icon.svg"):
        shutil.copy(os.path.join(UNI, f), os.path.join(OUT, "assets", "brand", f))

    # Branding: Demo Bank with the Universal edition's neutral logo and colours
    edit("index.html", [
        ("Forex Applications · Centenary Bank", "Forex Applications · Demo Bank"),
        ('type="image/jpeg" href="assets/brand/centenary-emblem.jpeg"', 'type="image/svg+xml" href="assets/brand/icon.svg"'),
        ('src="assets/brand/centenary-logo.svg" alt="Centenary Bank"', 'src="assets/brand/logo.svg" alt="Demo Bank"'),
    ])
    edit("js/brand.js", [
        ("bankName: 'Centenary Bank',                                     // bank name",
         "bankName: 'Demo Bank',                                          // bank name"),
        ("logo: 'assets/brand/centenary-logo.svg',     // wide logo", "logo: 'assets/brand/logo.svg',     // wide logo"),
        ("icon: 'assets/brand/centenary-emblem.jpeg',  // browser-tab icon", "icon: 'assets/brand/icon.svg',  // browser-tab icon"),
        ("primary: '#003da6',       // Centenary blue:", "primary: '#1f5fbf',       // main colour:"),
        ("accent: '#e11d2e',        // Centenary red:", "accent: '#e4572e',        // accent:"),
        ("highlight: '#f5ea61',     // Centenary yellow:", "highlight: '#f2c14e',     // highlight:"),
        ("emailDomain: 'centenarybank.test',", "emailDomain: 'demobank.example',"),
    ])

    # The brand asset list: the two neutral files instead of the Centenary ones
    cfg = os.path.join(OUT, "js", "config.js")
    lines = open(cfg, encoding="utf-8").read().splitlines(keepends=True)
    idx = [i for i, l in enumerate(lines) if "file: 'centenary-" in l]
    if not idx:
        fail("js/config.js: no Centenary brand asset entries found")
    indent = lines[idx[0]][: len(lines[idx[0]]) - len(lines[idx[0]].lstrip())]
    nl = "\r\n" if lines[idx[0]].endswith("\r\n") else "\n"
    new = [f"{indent}{{ file: 'logo.svg', name: 'Logo (SVG)', use: 'App sidebar; scales to any size', size: '1 KB', preview: true }},{nl}",
           f"{indent}{{ file: 'icon.svg', name: 'Icon (SVG)', use: 'Browser tab icon, avatars', size: '1 KB', preview: true }},{nl}"]
    lines = lines[: idx[0]] + new + [l for i, l in enumerate(lines[idx[0]:], idx[0]) if i not in idx]
    open(cfg, "w", encoding="utf-8", newline="").write("".join(lines))
    edit("js/config.js", [("@centenarybank.test", "@demobank.example"), ("senderName: 'Centenary Bank',", "senderName: 'Demo Bank',")], count=None)

    # Demo users: six, one per role; sample work of the removed users goes to Grace and James (Blantyre)
    store = os.path.join(OUT, "js", "store.js")
    text = open(store, encoding="utf-8").read()
    for uid in REMOVED_USERS:
        text, n = re.subn(r"^[ \t]*\{ id: '" + uid + r"',[^\n]*\n", "", text, flags=re.M)
        if n != 1:
            fail(f"js/store.js: demo user {uid} not found exactly once")
    for old, new in REMOVED_USERS.items():
        text = text.replace(f"'{old}'", f"'{new}'")
    text = text.replace("branchId: 'br_llw'", "branchId: 'br_bt'").replace("branchId: 'br_mz'", "branchId: 'br_bt'")
    text = text.replace("'u_grace', 'br_llw'", "'u_grace', 'br_bt'").replace("'u_grace', 'br_mz'", "'u_grace', 'br_bt'")
    text = text.replace("Client delivered the documents at our Lilongwe branch.", "Client delivered the documents at the branch.")
    open(store, "w", encoding="utf-8", newline="").write(text)
    edit("js/store.js", [
        ("const DEMO_PASSWORD = 'Centenary@2026';", "const DEMO_PASSWORD = 'Demo@2026';"),
        ("name: 'Centenary Bank', country: 'Malawi'", "name: 'Demo Bank', country: 'Malawi'"),
        ("KEY: 'cbm-forex-state-v1'", "KEY: 'cbm-forex-state-v2'"),  # visitors from before the user trim start fresh
    ])
    edit("js/store.js", [("@centenarybank.test", "@demobank.example")], count=None)

    edit("js/cbmlist.js", [("this bank's own (Centenary's) clients", "this bank's own clients")])
    edit("css/app.css", [("#003da6", "#1f5fbf"), ("#e11d2e", "#e4572e"), ("#f5ea61", "#f2c14e")], count=None)
    edit("js/auth.js", [
        ("'centenary'", "'demobank'"),  # in the list of passwords refused as too common
        ("${U.esc(Brand.current.bankName)} · Prototype</span>",
         "${U.esc(Brand.current.bankName)} · Prototype · Names of people are made up or randomly generated</span>"),
        ("Users created by the admin get a temporary password and must change it at first sign-in.</p>",
         "Users created by the admin get a temporary password and must change it at first sign-in. The names of demo "
         "users, customers and beneficiaries are made up or randomly generated; any resemblance to real people is "
         "coincidental.</p>"),
    ])
    edit("js/app.js", [("· Prototype – data stored in this browser only</span>",
                        "· Prototype – data stored in this browser only · names of people are made up or randomly generated</span>")])
    # No "Load test data" (it would add ~40 test users to the six demo accounts)
    edit("js/views-admin.js", [('<button id="dd-load">Load test data</button>', ""),
                               ("U.$('#dd-load').addEventListener", 'U.$("#dd-load")?.addEventListener')])

    # Final check: nothing may name the real bank
    left = []
    for root, _, files in os.walk(OUT):
        for f in files:
            p = os.path.join(root, f)
            if "centenary" in f.lower():
                left.append(p)
            elif f.endswith((".js", ".html", ".css", ".svg", ".json")):
                for i, line in enumerate(open(p, encoding="utf-8", errors="ignore"), 1):
                    if re.search(r"centenary|centebank|mybucks|new finance bank", line, re.I):
                        left.append(f"{os.path.relpath(p, OUT)}:{i}")
    if left:
        fail("Centenary references left: " + ", ".join(left[:10]))
    print(f"Forex demo rebuilt in {OUT} from {FX}")


if __name__ == "__main__":
    main()
