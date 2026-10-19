#!/bin/bash
# Run before pushing. Stamps ?v=<content hash> onto every local CSS/JS link in the
# HTML pages so browsers refetch a file as soon as it changes (GitHub Pages caches
# assets for 10 minutes otherwise). Safe to re-run; unchanged files keep their hash.
cd "$(dirname "$0")/.." || exit 1
python3 - <<'PY'
import hashlib, os, re, glob
pages = [p for p in glob.glob("**/*.html", recursive=True) if not p.startswith(("node_modules/", "linear-regression/"))]
pat = re.compile(r'((?:href|src)=")([^"?#:]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")')
for page in pages:
    src = open(page, encoding="utf-8").read()
    def stamp(m):
        path = m.group(2)
        full = path.lstrip("/") if path.startswith("/") else os.path.join(os.path.dirname(page), path)
        if not os.path.isfile(full):
            return m.group(0)
        h = hashlib.md5(open(full, "rb").read()).hexdigest()[:8]
        return f"{m.group(1)}{path}?v={h}{m.group(3)}"
    out = pat.sub(stamp, src)
    if out != src:
        open(page, "w", encoding="utf-8").write(out)
        print("stamped", page)
PY
