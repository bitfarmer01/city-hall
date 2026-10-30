"""Fillable-class detection: pure decision table + real fixture classes."""

from __future__ import annotations

import pytest

from pdf_extraction.classify import PdfProbe, detect_fillable_class
from pdf_extraction.extract import probe_pdf
from pdf_extraction.model import FillableClass

from conftest import fixture_pdf


def _probe(**overrides) -> PdfProbe:
    base = dict(
        has_acroform=False,
        xfa_present=False,
        n_acroform_fields=0,
        char_count=100,
        image_count=0,
        n_pages=1,
    )
    base.update(overrides)
    return PdfProbe(**base)


@pytest.mark.parametrize(
    "probe,expected",
    [
        (_probe(n_acroform_fields=10), FillableClass.ACROFORM),
        (_probe(xfa_present=True), FillableClass.XFA),
        (_probe(xfa_present=True, n_acroform_fields=1), FillableClass.HYBRID),
        (_probe(char_count=0, image_count=2), FillableClass.SCANNED),
        (_probe(), FillableClass.FLATTENED),
        # Degenerate: no fields, no text, no images -> flattened (nothing
        # to extract); never claimed as scanned (no image evidence).
        (_probe(char_count=0, image_count=0), FillableClass.FLATTENED),
    ],
)
def test_detect_fillable_class_table(probe: PdfProbe, expected: FillableClass):
    assert detect_fillable_class(probe) is expected


def test_probe_pw1_is_hybrid():
    import pdfplumber
    import pypdf

    path = fixture_pdf("pw1.pdf")
    reader = pypdf.PdfReader(str(path), strict=False)
    with pdfplumber.open(str(path)) as pdf:
        probe = probe_pdf(reader, pdf)
    assert detect_fillable_class(probe) is FillableClass.HYBRID
    assert probe.xfa_present
    assert probe.n_pages == 5


def test_probe_birth1_is_acroform():
    import pdfplumber
    import pypdf

    path = fixture_pdf("birth1.pdf")
    reader = pypdf.PdfReader(str(path), strict=False)
    with pdfplumber.open(str(path)) as pdf:
        probe = probe_pdf(reader, pdf)
    assert detect_fillable_class(probe) is FillableClass.ACROFORM
    assert probe.n_acroform_fields == 34


def test_probe_premium_birth_is_acroform():
    import pdfplumber
    import pypdf

    path = fixture_pdf("premium-birth.pdf")
    reader = pypdf.PdfReader(str(path), strict=False)
    with pdfplumber.open(str(path)) as pdf:
        probe = probe_pdf(reader, pdf)
    assert detect_fillable_class(probe) is FillableClass.ACROFORM
    assert probe.n_acroform_fields == 33


def test_probe_dog_license_is_flattened():
    import pdfplumber
    import pypdf

    path = fixture_pdf("dog-license.pdf")
    reader = pypdf.PdfReader(str(path), strict=False)
    with pdfplumber.open(str(path)) as pdf:
        probe = probe_pdf(reader, pdf)
    assert detect_fillable_class(probe) is FillableClass.FLATTENED
    assert probe.n_acroform_fields == 0
    assert probe.char_count > 0  # text layer exists; not scanned
