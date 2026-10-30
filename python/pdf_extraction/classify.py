"""Fillable-class detection (research section 2.4, step 2).

The pure decision function is separated from PDF I/O so all five classes
are unit-testable without fixture files covering each one.
"""

from __future__ import annotations

from dataclasses import dataclass

from pdf_extraction.model import FillableClass


@dataclass(frozen=True)
class PdfProbe:
    """Raw signals gathered from a PDF, before classification."""

    has_acroform: bool
    xfa_present: bool
    n_acroform_fields: int
    char_count: int
    image_count: int
    n_pages: int


def detect_fillable_class(probe: PdfProbe) -> FillableClass:
    """Pure classification of a PDF probe into a FillableClass.

    - XFA present + live AcroForm fields -> hybrid (static XFA wrapped
      in AcroForm).
    - XFA present without live fields -> xfa (the form model lives in the
      XDP XML packet; pypdf get_fields() may return little or nothing).
    - Live AcroForm fields without XFA -> acroform.
    - No live fields: a text layer means flattened (the printed form is
      real page content); no text layer means scanned (image-only).
      A degenerate file with neither text nor images is reported as
      flattened (it presents zero flat content to extract).
    """
    if probe.xfa_present and probe.n_acroform_fields > 0:
        return FillableClass.HYBRID
    if probe.xfa_present:
        return FillableClass.XFA
    if probe.n_acroform_fields > 0:
        return FillableClass.ACROFORM
    if probe.char_count == 0 and probe.image_count > 0:
        return FillableClass.SCANNED
    return FillableClass.FLATTENED
