"""Inline data.js + engine.js + app.js + styles.css into one self-contained page.
   dist/ripasso.html          full standalone page (works from file:// too)
   dist/ripasso-artifact.html  body fragment for publishing as a claude.ai artifact"""
import re, pathlib
here = pathlib.Path(__file__).parent
def strip(src):
    src = re.sub(r"^import .*?;\s*$", "", src, flags=re.M)
    src = re.sub(r"^export \{[^}]*\};?\s*$", "", src, flags=re.M)
    return re.sub(r"^export (const|function)", r"\1", src, flags=re.M)
js = "\n".join(strip((here / f).read_text()) for f in ["data.js", "engine.js", "app.js"])
css = (here / "styles.css").read_text()
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&display=swap">'
body = f'<div id="app"></div>\n<script>\n(() => {{\n{js}\n}})();\n</script>'
(here / "dist").mkdir(exist_ok=True)
(here / "dist/ripasso-artifact.html").write_text(
    f'<title>Ripasso Italiano</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n{fonts}\n<style>\n{css}</style>\n{body}\n')
(here / "dist/ripasso.html").write_text(
    f'<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>Ripasso Italiano</title>\n{fonts}\n<style>\n:root{{padding-top:env(safe-area-inset-top,0px)}}\n{css}</style></head>\n<body>\n{body}\n</body></html>\n')
print("built", len(js), "bytes of JS")
