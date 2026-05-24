#!/usr/bin/env python3
"""
ATS (Applicant Tracking System) compatibility checker for resume PDFs.

Analyzes a PDF resume and reports potential ATS issues:
  - Text extractability (can the parser read the content?)
  - Required sections present (Experience, Education, Skills)
  - File size
  - Potential problematic elements

Usage:
    python scripts/ats_check.py build/swe/resume.pdf
    python scripts/ats_check.py output/swe/resume.pdf --verbose
    python scripts/ats_check.py build/base/resume.pdf --format json
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


# ── Required sections every ATS-friendly resume should have ──────────
REQUIRED_SECTIONS = [
    r"(?i)\b(?:experience|employment|professional\s*experience|work\s*experience)\b",
    r"(?i)\beducation\b",
    r"(?i)\bskills\b",
]

# ── Patterns that may indicate ATS-unfriendly elements ───────────────
PROBLEM_PATTERNS = [
    (r"\\begin\{tabular\}", "LaTeX tabular environment (confuses some ATS parsers)"),
    (r"\\begin\{longtable\}", "LaTeX longtable environment"),
    (r"\\includegraphics", "Embedded image (text may not be extractable)"),
    (r"\\multicolumn", "Multi-column layout (may confuse linear text extraction)"),
    (r"\\begin\{multicols\}", "Multi-column layout"),
    (r"\\columnsep", "Multi-column layout"),
    (r"\\begin\{tikzpicture\}", "TikZ graphic (text extraction issues)"),
    (r"\\fa[Gg]ithub", "Icon font — may not render as text"),
    (r"\\fa[lL]inkedin", "Icon font — may not render as text"),
    (r"\\fa[A-Za-z]", "Font Awesome icon — may not render as text"),
]

SMALL_FILE_SIZE_WARN = 20   # kB — suspiciously small (probably all graphics)
LARGE_FILE_SIZE_WARN = 500  # kB — might be image-heavy


def check_pdftotext_available():
    return shutil_which("pdftotext") is not None


def shutil_which(cmd):
    """Find executable in PATH."""
    for path in os.environ.get("PATH", "").split(os.pathsep):
        full = os.path.join(path, cmd)
        if os.path.isfile(full) and os.access(full, os.X_OK):
            return full
    return None


def extract_text_pdftotext(pdf_path):
    """Extract text using pdftotext (poppler-utils)."""
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True, text=True, timeout=30,
    )
    return result.stdout


def extract_text_pypdf(pdf_path):
    """Fallback: extract text with pypdf if available."""
    try:
        import pypdf
        reader = pypdf.PdfReader(str(pdf_path))
        text = []
        for page in reader.pages:
            text.append(page.extract_text() or "")
        return "\n".join(text)
    except ImportError:
        return None


def extract_text(pdf_path):
    text = extract_text_pdftotext(pdf_path)
    if text and text.strip():
        return text, "pdftotext"

    text = extract_text_pypdf(pdf_path)
    if text is not None:
        return text, "pypdf"

    return "", "none"


def extract_text_raw_fallback(pdf_path):
    """Last resort: scan raw PDF for readable ASCII strings."""
    with open(pdf_path, "rb") as f:
        raw = f.read()
    # Extract ASCII strings
    strings = re.findall(rb"[\x20-\x7E]{4,}", raw)
    return b"\n".join(strings).decode("ascii", errors="replace")


def check_tex_source(pdf_path, pdf_dir):
    """Find and scan the corresponding .tex source for problem patterns."""
    # Check alongside PDF first (build/ dir), then output dir
    candidates = [
        os.path.join(pdf_dir, "resume.tex"),
        os.path.join(os.path.dirname(pdf_dir), "resume.tex"),
    ]
    # Also check build/<variant>/resume.tex
    variant = os.path.basename(pdf_dir)
    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates.append(os.path.join(ROOT, "build", variant, "resume.tex"))

    for tex_path in candidates:
        if os.path.exists(tex_path):
            with open(tex_path) as f:
                return f.read()
    return None

    with open(tex_path) as f:
        content = f.read()
    return content


def run_checks(pdf_path, verbose=False):
    results = {
        "file": str(pdf_path),
        "pass": True,
        "checks": {},
    }

    # 1. File size
    size_kb = os.path.getsize(pdf_path) / 1024
    results["checks"]["file_size_kb"] = round(size_kb, 1)
    if size_kb < SMALL_FILE_SIZE_WARN:
        results["checks"]["file_size_warning"] = (
            f"Very small ({size_kb:.1f} kB) — may lack extractable text"
        )
        results["pass"] = False
    elif size_kb > LARGE_FILE_SIZE_WARN:
        results["checks"]["file_size_warning"] = (
            f"Large file ({size_kb:.1f} kB) — may contain embedded images"
        )

    # 2. Text extraction
    text, method = extract_text(pdf_path)
    text_len = len(text.strip())
    results["checks"]["text_extraction"] = {
        "method": method,
        "char_count": text_len,
    }

    if text_len < 100:
        # Try raw fallback
        raw_text = extract_text_raw_fallback(pdf_path)
        raw_len = len(raw_text.strip())
        results["checks"]["text_extraction"]["raw_fallback_chars"] = raw_len
        if raw_len > text_len:
            text = raw_text
            text_len = raw_len
            results["checks"]["text_extraction"]["note"] = (
                "Standard extraction yielded little text. "
                "Raw PDF strings found — text may still be parseable."
            )
        else:
            results["checks"]["text_extraction"]["warning"] = (
                f"Only {text_len} chars extracted — ATS may not read this PDF"
            )
            results["pass"] = False

    # 3. Required sections
    found_sections = []
    missing_sections = []
    for i, pattern in enumerate(REQUIRED_SECTIONS):
        if re.search(pattern, text):
            found_sections.append(pattern)
        else:
            missing_sections.append(pattern)

    results["checks"]["sections"] = {
        "found": [str(p) for p in found_sections],
        "missing": [str(p) for p in missing_sections],
    }
    if missing_sections:
        results["pass"] = False

    # 4. Scan .tex for problem patterns
    tex_content = check_tex_source(pdf_path, os.path.dirname(pdf_path))
    warnings = []
    if tex_content:
        for pattern, desc in PROBLEM_PATTERNS:
            if re.search(pattern, tex_content):
                warnings.append(desc)
    else:
        warnings.append("No .tex source found for pattern analysis")

    results["checks"]["tex_warnings"] = warnings
    if warnings:
        # Warnings don't necessarily fail ATS, just note them
        pass

    # 5. Overall
    results["pass"] = results["pass"] and not missing_sections

    return results


def print_report(results, verbose=False):
    print(f"\n{'='*60}")
    print(f"ATS Check: {results['file']}")
    print(f"{'='*60}")

    checks = results["checks"]

    # File size
    w = checks.get("file_size_warning")
    sz = checks["file_size_kb"]
    print(f"\n[File] {sz} kB" + (f"  ⚠ {w}" if w else ""))

    # Text
    tx = checks["text_extraction"]
    method_label = {"pdftotext": "pdftotext", "pypdf": "pypdf", "none": "none"}
    print(f"[Text] {tx['char_count']} chars extracted via {method_label.get(tx['method'], tx['method'])}")
    if "warning" in tx:
        print(f"       ⚠ {tx['warning']}")
    if "note" in tx:
        print(f"       ℹ {tx['note']}")

    # Sections
    sec = checks["sections"]
    print(f"[Sections] Found: {len(sec['found'])}  Missing: {len(sec['missing'])}")
    for p in sec["found"]:
        label = p.replace(r"(?i)", "").replace(r"\b", "").replace(r"\s*", " ").strip()
        print(f"           ✓ {label}")
    for p in sec["missing"]:
        label = p.replace(r"(?i)", "").replace(r"\b", "").replace(r"\s*", " ").strip()
        print(f"           ✗ {label}")

    # Warnings
    if checks.get("tex_warnings"):
        print(f"\n[Warnings]")
        for w in checks["tex_warnings"]:
            print(f"           ⚠ {w}")

    # Verdict
    print(f"\n{'─'*60}")
    if results["pass"]:
        print("VERDICT: PASS — ATS-friendly")
    else:
        reasons = []
        if sec["missing"]:
            reasons.append("missing required sections")
        if "warning" in tx:
            reasons.append("text extraction issue")
        print(f"VERDICT: NEEDS REVIEW — {'; '.join(reasons)}")
    print(f"{'─'*60}\n")


def main():
    parser = argparse.ArgumentParser(description="ATS compatibility checker for resume PDFs")
    parser.add_argument("pdf", nargs="?", help="Path to PDF resume")
    parser.add_argument("--verbose", "-v", action="store_true", help="Detailed output")
    parser.add_argument("--format", choices=["text", "json"], default="text",
                        help="Output format (default: text)")
    args = parser.parse_args()

    pdf_path = args.pdf
    if not pdf_path:
        # Check default output locations
        candidates = []
        for root, dirs, files in os.walk(
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output")
        ):
            for f in files:
                if f.endswith(".pdf"):
                    candidates.append(os.path.join(root, f))
        if not candidates:
            print("No PDFs found in output/. Build one first or specify a path.")
            sys.exit(1)

        print("Available PDFs:")
        for i, p in enumerate(candidates, 1):
            rel = os.path.relpath(p, os.getcwd())
            print(f"  {i}. {rel}")

        try:
            choice = input("\nSelect number (or Ctrl+C to quit): ").strip()
            pdf_path = candidates[int(choice) - 1]
        except (ValueError, IndexError, KeyboardInterrupt):
            print("Invalid selection")
            sys.exit(1)

    if not os.path.exists(pdf_path):
        print(f"Error: {pdf_path} not found")
        sys.exit(1)

    results = run_checks(pdf_path, verbose=args.verbose)

    if args.format == "json":
        print(json.dumps(results, indent=2))
    else:
        print_report(results, verbose=args.verbose)

    sys.exit(0 if results["pass"] else 1)


if __name__ == "__main__":
    main()
