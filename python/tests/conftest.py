"""Shared test fixtures: paths and a synthetic AcroForm PDF builder.

The synthetic builder constructs a minimal PDF by hand (computed xref)
so the author-declared Required flag can be exercised end-to-end - none
of the real NYC fixtures uses it.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "pdfs"


def fixture_pdf(name: str) -> Path:
    path = FIXTURES_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"fixture missing: {path}")
    return path


def build_acroform_pdf(
    fields: list[dict],
) -> bytes:
    """Build a minimal AcroForm PDF with the given field dicts.

    Each field dict: {"name": str, "ft": "/Tx", "ff": int | None}.
    Field objects start at number 5 (1 catalog, 2 pages, 3 page, 4 spare).
    """
    objects: list[bytes] = []
    n = len(fields)
    field_refs = " ".join(f"{5 + i} 0 R" for i in range(n))

    objects.append(
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields ["
        + field_refs.encode()
        + b"] >> >>"
    )
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots ["
        + field_refs.encode()
        + b"] >> >>"
    )
    objects.append(b"<< >>")  # spare object 4, unused
    for i, spec in enumerate(fields):
        ff = spec.get("ff")
        ff_part = f" /Ff {ff}" if ff is not None else ""
        body = (
            f"<< /Type /Annot /Subtype /Widget /FT {spec['ft']} /T ({spec['name']})"
            f"{ff_part} /Rect [72 700 300 720] /P 3 0 R >>"
        ).encode()
        objects.append(body)

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets: list[int] = []
    for num, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{num} 0 obj\n".encode() + body + b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    )
    out.write(trailer.encode())
    return out.getvalue()


@pytest.fixture
def synthetic_acroform_required(tmp_path: Path) -> Path:
    pdf_path = tmp_path / "required-field.pdf"
    pdf_path.write_bytes(
        build_acroform_pdf(
            [
                {"name": "RequiredField", "ft": "/Tx", "ff": 2},
                {"name": "OptionalField", "ft": "/Tx", "ff": None},
            ]
        )
    )
    return pdf_path
