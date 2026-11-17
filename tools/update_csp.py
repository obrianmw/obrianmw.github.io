"""Adds a Content-Security-Policy and referrer policy (meta tags) to every page of the static site.

Inline scripts are allowed only by their exact SHA-256 hash, so a script injected into a page can't run, and pages can
only load scripts from this site and fonts from Google Fonts. Re-run after editing an inline script or adding a page
(it replaces the tags it added before):

    python tools/update_csp.py client
"""
import base64
import glob
import hashlib
import os
import re
import sys

MARK = "<!-- security: CSP + referrer (python tools/update_csp.py client) -->"
OLD_TAGS = re.compile(r"<!-- security: CSP \+ referrer.*?<!-- /security -->\r?\n?", re.S)
# The forex demo is the browser-only copy of the Forex system: the same policy its own server sends.
EVENTS_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
              "font-src 'self' data:; connect-src 'self'; media-src 'self' blob: data:; frame-src 'self' blob: data:; "
              "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'")


def sha(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")  # browsers hash the text with line endings normalised
    return "'sha256-%s'" % base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()


def csp_for(rel, html):
    if rel.startswith("demo/forex/"):
        return EVENTS_CSP
    scripts = [sha(m.group(1)) for m in re.finditer(r"<script>(.*?)</script>", html, re.S)]
    handlers = [sha(m.group(1)) for m in re.finditer(r'\son[a-z]+="([^"]*)"', html)]
    script_src = " ".join(["'self'"] + scripts + (["'unsafe-hashes'"] + handlers if handlers else []))
    return ("default-src 'self'; script-src %s; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data:; frame-src 'self'; connect-src 'self'; "
            "object-src 'none'; base-uri 'self'; form-action 'none'" % script_src)


def main(root):
    changed = 0
    for path in sorted(glob.glob(os.path.join(root, "**", "*.html"), recursive=True)):
        rel = os.path.relpath(path, root).replace("\\", "/")
        with open(path, encoding="utf-8", newline="") as f:
            html = f.read()
        html = OLD_TAGS.sub("", html)
        m = re.search(r"<meta charset=[^>]*>", html, re.I)
        if not m:
            print("skipped (no <meta charset>):", rel)
            continue
        tags = ('%s<meta http-equiv="Content-Security-Policy" content="%s"><meta name="referrer" '
                'content="strict-origin-when-cross-origin"><!-- /security -->' % (MARK, csp_for(rel, html)))
        newline = "\r\n" if "\r\n" in html else "\n"
        after = html[m.end():]
        lead = newline if after.startswith(("\n", "\r\n")) else ""
        html = html[:m.end()] + lead + tags + after
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(html)
        changed += 1
    print(changed, "pages")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "client")
