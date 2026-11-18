"""Rebuild the self-hosted font subsets in fonts/ from the variable sources in tools/_src/.

Run after editing page text:  python -X utf8 tools/subset_fonts.py

Sources (SIL OFL, from https://github.com/google/fonts/tree/main/ofl/), not committed:
  tools/_src/NotoSerifSC-VF.ttf   <- notoserifsc/NotoSerifSC[wght].ttf
  tools/_src/NotoSansSC-VF.ttf    <- notosanssc/NotoSansSC[wght].ttf
  tools/_src/Jost-VF.ttf          <- jost/Jost[wght].ttf
"""
from html.parser import HTMLParser
from pathlib import Path
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "_src"
OUT = ROOT / "fonts"
PAGES = ["index.html", "404.html"]

BASIC_LATIN = {chr(c) for c in range(0x20, 0x7F)}
# the Latin face also sets a few typographic marks that appear inside its lines
LATIN_EXTRA = set("·—–’“”")

# (source file, output stem, weights, use page CJK characters?)
JOBS = [
    ("NotoSerifSC-VF.ttf", "notoserifsc", (300, 400), True),
    ("NotoSansSC-VF.ttf", "notosanssc", (300, 400), True),
    ("Jost-VF.ttf", "jost", (400, 500), False),
]


class TextCollector(HTMLParser):
    """Collects characters that can be rendered: body text plus title, skipping script/style."""

    SKIP = {"script", "style"}

    def __init__(self):
        super().__init__()
        self.depth = 0
        self.chars = set()

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if not self.depth:
            self.chars.update(data)


def page_chars():
    chars = set()
    for name in PAGES:
        p = TextCollector()
        p.feed((ROOT / name).read_text(encoding="utf-8"))
        chars |= p.chars
    return {c for c in chars if c.isprintable()}


def build(src, stem, weights, text):
    for w in weights:
        font = TTFont(SRC / src)
        font = instancer.instantiateVariableFont(font, {"wght": w}, inplace=False)
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]  # keep vert/vrt2 for the vertical name plate
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        opts.hinting = False
        sub = subset.Subsetter(opts)
        sub.populate(text="".join(sorted(text)))
        sub.subset(font)
        out = OUT / f"{stem}-{w}.woff2"
        font.flavor = "woff2"
        font.save(out)
        print(f"{out.relative_to(ROOT)}  {out.stat().st_size} bytes")


def main():
    missing = [j[0] for j in JOBS if not (SRC / j[0]).exists()]
    if missing:
        sys.exit(f"missing sources in {SRC}: {', '.join(missing)}")
    OUT.mkdir(exist_ok=True)
    cjk = page_chars() | BASIC_LATIN
    print(f"{len(cjk)} characters from {', '.join(PAGES)}")
    for src, stem, weights, use_page in JOBS:
        build(src, stem, weights, cjk if use_page else BASIC_LATIN | LATIN_EXTRA)


if __name__ == "__main__":
    main()
