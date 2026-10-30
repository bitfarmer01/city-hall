"""CLI: extract PDF forms into catalog JSON.

Usage:
    python -m pdf_extraction FORM.pdf --source-url URL --agency buildings
        [--form-number PW1] [--captured-at ISO8601] [--http-status 200]
        [--out catalog.json]

Prints catalog JSON to stdout when --out is omitted. Fails loudly on
unreadable PDFs (non-zero exit), never with a silently empty catalog.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pdf_extraction.extract import emit_catalog_json, extract_form


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="pdf_extraction",
        description="Extract NYC PDF forms into catalog JSON.",
    )
    parser.add_argument("pdf", type=str, help="path to the PDF form")
    parser.add_argument(
        "--source-url", required=True, help="public URL the PDF was fetched from"
    )
    parser.add_argument(
        "--agency", required=True, help="agency slug, e.g. buildings, dohmh"
    )
    parser.add_argument("--form-number", default=None, help="printed form number, e.g. PW1")
    parser.add_argument(
        "--captured-at",
        required=True,
        help="ISO-8601 UTC timestamp of the public HTTP fetch of the PDF",
    )
    parser.add_argument("--http-status", type=int, default=200)
    parser.add_argument("--out", default=None, help="output path (default: stdout)")
    args = parser.parse_args(argv)

    try:
        extracted = extract_form(
            path=args.pdf,
            source_url=args.source_url,
            agency=args.agency,
            captured_at=args.captured_at,
            form_number=args.form_number,
            http_status=args.http_status,
        )
    except Exception as exc:  # surface, never swallow
        print(f"extraction failed: {exc}", file=sys.stderr)
        return 1

    payload = emit_catalog_json(extracted)
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
