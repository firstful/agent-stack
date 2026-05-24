#!/usr/bin/env python3
"""
Resume build system.
1. Load base YAML + optional variant YAML (variant deeply merges into base)
2. Render Jinja2 LaTeX template
3. Compile .tex -> PDF via pdflatex (if available)

Usage:
    python scripts/build.py                          # build all variants
    python scripts/build.py --variant swe            # build one variant
    python scripts/build.py --variant swe --no-pdf   # template only, no pdflatex
    python scripts/build.py --list                   # list available variants
"""

import argparse
import copy
import glob
import os
import shutil
import subprocess
import sys
import tempfile

import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
TEMPLATE_DIR = os.path.join(ROOT, "templates")
BUILD_DIR = os.path.join(ROOT, "build")
OUTPUT_DIR = os.path.join(ROOT, "output")
BASE_FILE = os.path.join(DATA_DIR, "base.yaml")

TEMPLATE_NAME = "main.tex.j2"
OUTPUT_TEX = "resume.tex"
OUTPUT_PDF = "resume.pdf"


def deep_merge(base, override):
    """Recursively merge override into base (modifies base in-place)."""
    for key, value in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            deep_merge(base[key], value)
        elif key in base and isinstance(base[key], list) and isinstance(value, list):
            base[key] = value  # variant replaces lists entirely
        else:
            base[key] = value
    return base


def list_variants():
    variants = []
    for f in sorted(glob.glob(os.path.join(DATA_DIR, "*.yaml"))):
        name = os.path.splitext(os.path.basename(f))[0]
        if name != "base":
            variants.append(name)
    return variants


def _escape_latex(obj):
    """Recursively escape LaTeX special characters in all string values."""
    if isinstance(obj, str):
        return obj.replace("\\", "\\textbackslash{}") \
                  .replace("#", "\\#") \
                  .replace("$", "\\$") \
                  .replace("%", "\\%") \
                  .replace("&", "\\&") \
                  .replace("_", "\\_") \
                  .replace("{", "\\{") \
                  .replace("}", "\\}") \
                  .replace("~", "\\textasciitilde{}") \
                  .replace("^", "\\textasciicircum{}")
    elif isinstance(obj, dict):
        return {k: _escape_latex(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_escape_latex(item) for item in obj]
    return obj


def load_data(variant=None):
    with open(BASE_FILE) as f:
        data = yaml.safe_load(f)

    if variant:
        variant_file = os.path.join(DATA_DIR, f"{variant}.yaml")
        if not os.path.exists(variant_file):
            print(f"Error: variant '{variant}' not found at {variant_file}")
            sys.exit(1)
        with open(variant_file) as f:
            override = yaml.safe_load(f)
        data = deep_merge(data, override)

    # Precompute rendered contact info and links for template (before escaping)
    contact_parts = []
    for field in ("email", "phone", "location"):
        if data.get(field):
            contact_parts.append(data[field])
    data["_contact_line"] = " | ".join(contact_parts)

    link_parts = []
    for key in ("github", "linkedin", "website"):
        val = data.get(key)
        if val:
            if not val.startswith("http"):
                val = f"https://{val}"
            display = val.replace("https://", "").rstrip("/")
            link_parts.append(r"\href{" + val + "}{" + display + "}")
    data["_links"] = " | ".join(link_parts)

    # Escape LaTeX special characters in all remaining string values
    for key in list(data.keys()):
        if not key.startswith("_"):
            data[key] = _escape_latex(data[key])

    return data


def build_variant(variant, run_pdf=True, anonymize=False):
    variant_label = variant or "base"
    if anonymize:
        variant_label += "-anon"
    print(f"\n=== Building variant: {variant_label} ===")

    data = load_data(variant)
    if anonymize:
        data["_anonymize"] = True
        data["name"] = ""
        data["email"] = ""
        data["phone"] = ""
        data["location"] = ""
        data["github"] = ""
        data["linkedin"] = ""
        data["website"] = ""
        data["_contact_line"] = ""
        data["_links"] = ""

    env = Environment(
        loader=FileSystemLoader(TEMPLATE_DIR),
        autoescape=select_autoescape(default=False),
    )
    template = env.get_template(TEMPLATE_NAME)

    tex_content = template.render(**data)

    out_dir = os.path.join(BUILD_DIR, variant_label)
    os.makedirs(out_dir, exist_ok=True)

    tex_path = os.path.join(out_dir, OUTPUT_TEX)
    with open(tex_path, "w") as f:
        f.write(tex_content)

    print(f"  -> {tex_path}")

    if run_pdf:
        _compile_pdf(out_dir)

    return tex_path


def _compile_pdf(work_dir):
    """Run pdflatex twice for stable cross-references."""
    try:
        for _ in range(2):
            subprocess.run(
                ["pdflatex", "-interaction=nonstopmode", OUTPUT_TEX],
                cwd=work_dir,
                capture_output=True,
                timeout=60,
            )
    except FileNotFoundError:
        print("  !! pdflatex not found. Install TeX Live or use --no-pdf")
        return

    pdf_path = os.path.join(work_dir, OUTPUT_PDF)
    if os.path.exists(pdf_path):
        out_dir = os.path.join(OUTPUT_DIR, os.path.basename(work_dir))
        os.makedirs(out_dir, exist_ok=True)
        dest = os.path.join(out_dir, OUTPUT_PDF)
        shutil.copy2(pdf_path, dest)
        print(f"  -> {dest}")
    else:
        print("  !! PDF generation failed — check .tex for errors")
        return

    # Clean up auxiliary files
    for ext in (".aux", ".log", ".out"):
        f = os.path.join(work_dir, f"{os.path.splitext(OUTPUT_TEX)[0]}{ext}")
        if os.path.exists(f):
            os.remove(f)


def main():
    parser = argparse.ArgumentParser(description="Build resume PDFs from YAML data")
    parser.add_argument("--variant", "-v", help="Variant to build (omit for all)")
    parser.add_argument("--no-pdf", action="store_true", help="Skip PDF compilation")
    parser.add_argument("--anonymize", action="store_true", help="Build anonymized versions (no PII)")
    parser.add_argument("--list", action="store_true", help="List available variants")
    args = parser.parse_args()

    if args.list:
        variants = list_variants()
        print("Available variants:")
        for v in variants:
            print(f"  - {v}")
        return

    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    variants_to_build = [args.variant] if args.variant else ([None] + list_variants())

    for v in variants_to_build:
        build_variant(v, run_pdf=not args.no_pdf, anonymize=args.anonymize)
        if not args.anonymize:
            build_variant(v, run_pdf=not args.no_pdf, anonymize=True)

    print("\n=== Done ===")


if __name__ == "__main__":
    main()
