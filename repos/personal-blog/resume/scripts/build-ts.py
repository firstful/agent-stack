#!/usr/bin/env python3
"""
Compile TypeScript bundles to JS + copy CSS.

Bundles:
  interactive.ts  → docs/assets/resume/interactive.js  (resume flowchart page)
  theme.ts        → docs/assets/resume/theme.js        (base template — every page)
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS_DIR = os.path.join(ROOT, "ts")
OUT_DIR = os.path.join(ROOT, "..", "docs", "assets", "resume")

BUNDLES = [
    ("interactive.ts", "interactive.js"),
    ("theme.ts",       "theme.js"),
]


def build_bundle(entry, outfile):
    outpath = os.path.join(OUT_DIR, outfile)
    result = subprocess.run(
        [
            "npx", "esbuild", entry,
            "--bundle", "--minify",
            f"--outfile={outpath}",
        ],
        capture_output=True, text=True, cwd=TS_DIR,
    )
    if result.returncode != 0:
        print(f"esbuild error ({entry}):")
        print(result.stderr)
        sys.exit(1)
    return outpath


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # Install deps if needed
    if not os.path.exists(os.path.join(TS_DIR, "node_modules")):
        subprocess.run(["npm", "install"], check=True, cwd=TS_DIR)

    # TypeScript typecheck
    result = subprocess.run(
        ["npx", "tsc", "--noEmit"], capture_output=True, text=True, cwd=TS_DIR
    )
    if result.returncode != 0:
        print("TypeScript errors:")
        print(result.stderr)
        sys.exit(1)

    print("TypeScript: OK")

    # Build each bundle
    for entry, outfile in BUNDLES:
        outpath = build_bundle(entry, outfile)
        size = os.path.getsize(outpath)
        print(f"  {outfile:25s} {size:>6} bytes  ({outpath})")

    # Copy CSS
    shutil.copy2(
        os.path.join(TS_DIR, "interactive.css"),
        os.path.join(OUT_DIR, "interactive.css"),
    )
    css_size = os.path.getsize(os.path.join(OUT_DIR, "interactive.css"))
    print(f"  interactive.css        {css_size:>6} bytes")


if __name__ == "__main__":
    main()
