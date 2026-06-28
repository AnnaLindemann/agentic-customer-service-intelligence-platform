#!/usr/bin/env python3
"""
Generate the policy PDF knowledge sources from their Markdown source documents.

The Markdown files in `docs/policies/` are the editable source of truth. This script
renders them into the PDF documents that Phase 4's semantic retrieval pipeline
(PDF -> text extraction -> chunking -> embeddings -> vector index) will consume.

It is intentionally dependency-free: it uses only the Python standard library and
emits a minimal but valid PDF 1.4 file with the built-in Helvetica fonts. This avoids
adding any third-party toolchain (pandoc, wkhtmltopdf, LaTeX, npm PDF libs) to the
project just to produce three static artifacts.

Usage:
    python3 scripts/generate-policy-pdfs.py
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "docs" / "policies"
OUT_DIR = ROOT / "data" / "pdfs"

# Markdown source file -> output PDF filename (spaced, as required by the roadmap).
DOCUMENTS = {
    "customer-service-policy.md": "Customer Service Policy.pdf",
    "billing-policy.md": "Billing Policy.pdf",
    "product-availability-policy.md": "Product Availability Policy.pdf",
}

# --- Page geometry (US Letter, points) -----------------------------------
PAGE_W, PAGE_H = 612.0, 792.0
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 64.0, 740.0, 64.0
WRAP_CHARS = 92  # approximate wrap width for body text at 11pt Helvetica

# Map the few non-ASCII characters used in the sources to ASCII equivalents.
UNICODE_MAP = {
    "—": "-",   # em dash
    "–": "-",   # en dash
    "‘": "'", "’": "'",  # curly single quotes
    "“": '"', "”": '"',  # curly double quotes
    "•": "-",   # bullet
    "°": " deg",  # degree sign
    " ": " ",   # non-breaking space
}


def to_ascii(text: str) -> str:
    for uni, ascii_ in UNICODE_MAP.items():
        text = text.replace(uni, ascii_)
    return "".join(ch if ord(ch) < 128 else "?" for ch in text)


def strip_inline(text: str) -> str:
    """Remove inline Markdown syntax, keeping the human-readable text."""
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # links -> label
    text = text.replace("**", "").replace("`", "")
    return text.strip()


# A rendered line is (text, font_key, size, gap_before).
def parse_markdown(md: str):
    lines = []

    def add(text, font="F1", size=11.0, gap=0.0):
        lines.append((text, font, size, gap))

    raw_lines = md.splitlines()
    for raw in raw_lines:
        line = raw.rstrip()
        if not line.strip():
            add("", "F1", 11.0, 4.0)
            continue

        # Headings.
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            text = strip_inline(m.group(2))
            size = {1: 19.0, 2: 14.0, 3: 12.0}.get(level, 11.0)
            add(text, "F2", size, 10.0 if level <= 2 else 6.0)
            continue

        # Table rows.
        if line.lstrip().startswith("|"):
            if re.match(r"^\s*\|[\s:|-]+\|\s*$", line):
                continue  # separator row
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            text = "   ".join(strip_inline(c) for c in cells)
            for chunk in wrap(text, WRAP_CHARS):
                add(chunk, "F1", 10.0)
            continue

        # Bullet / list items.
        m = re.match(r"^\s*[-*]\s+(.*)$", line)
        if m:
            text = strip_inline(m.group(1))
            wrapped = wrap(text, WRAP_CHARS - 2)
            for i, chunk in enumerate(wrapped):
                add(("- " if i == 0 else "  ") + chunk, "F1", 11.0)
            continue

        # Bold-only metadata lines, paragraphs.
        text = strip_inline(line)
        for chunk in wrap(text, WRAP_CHARS):
            add(chunk, "F1", 11.0)

    return lines


def wrap(text: str, width: int):
    words = text.split()
    if not words:
        return [""]
    out, cur = [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            out.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}" if cur else w
    if cur:
        out.append(cur)
    return out


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def paginate(lines):
    """Split rendered lines into pages, returning a list of (text, font, size, y)."""
    pages, page = [], []
    y = MARGIN_TOP
    for text, font, size, gap in lines:
        leading = size + 3.0
        y -= gap
        if y - leading < MARGIN_BOTTOM:
            pages.append(page)
            page, y = [], MARGIN_TOP
        page.append((text, font, size, y))
        y -= leading
    if page:
        pages.append(page)
    return pages


def build_content_stream(page) -> bytes:
    parts = ["BT"]
    cur_font = None
    for text, font, size, y in page:
        token = (font, size)
        if token != cur_font:
            parts.append(f"/{font} {size:.1f} Tf")
            cur_font = token
        parts.append(f"1 0 0 1 {MARGIN_X:.1f} {y:.1f} Tm")
        if text:
            parts.append(f"({pdf_escape(to_ascii(text))}) Tj")
    parts.append("ET")
    return ("\n".join(parts) + "\n").encode("latin-1")


def build_pdf(pages) -> bytes:
    # Object layout: 1 Catalog, 2 Pages, 3 F1, 4 F2, then per page: Page + Contents.
    objects: list[bytes] = []
    n_pages = len(pages)
    page_obj_ids = [5 + 2 * i for i in range(n_pages)]
    content_obj_ids = [6 + 2 * i for i in range(n_pages)]

    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    objects.append(f"<< /Type /Pages /Count {n_pages} /Kids [{kids}] >>".encode("latin-1"))
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    for i, page in enumerate(pages):
        page_dict = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:.0f} {PAGE_H:.0f}] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            f"/Contents {content_obj_ids[i]} 0 R >>"
        ).encode("latin-1")
        objects.append(page_dict)
        stream = build_content_stream(page)
        content = b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream"
        objects.append(content)

    # Assemble file with a cross-reference table.
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for idx, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode("latin-1") + body + b"\nendobj\n"

    xref_pos = len(out)
    count = len(objects) + 1
    out += f"xref\n0 {count}\n".encode("latin-1")
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode("latin-1")
    out += (
        f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
    ).encode("latin-1")
    return bytes(out)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for md_name, pdf_name in DOCUMENTS.items():
        md_path = SRC_DIR / md_name
        md = md_path.read_text(encoding="utf-8")
        pages = paginate(parse_markdown(md))
        pdf_bytes = build_pdf(pages)
        (OUT_DIR / pdf_name).write_bytes(pdf_bytes)
        print(f"  {md_name}  ->  {pdf_name}  ({len(pages)} page(s), {len(pdf_bytes)} bytes)")
    print(f"Generated {len(DOCUMENTS)} policy PDF(s) in {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
