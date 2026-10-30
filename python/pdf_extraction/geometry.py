"""Geometry-based extraction for flattened forms (research section 2.2).

Flattened forms have no live fields: the printed form is ordinary page
content. Fill-in targets are recovered as geometry - horizontal rules and
boxes (pdfplumber lines/rects) - and labels are associated by nearest-text
positioning. Every recovered field is honest about its grade: provenance
is layout_geometry, requiredStatus can only be inferred_required or
unknown, and labels carry their own confidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pdfplumber

from pdf_extraction.provenance import PDFPLUMBER_TOOL

# Association windows, in points. Tuned against the dog-license fixture:
# labels sit ~15-20pt above their write-on rule, and side labels sit
# within 150pt to the left of short rules.
MAX_VERTICAL_GAP = 25.0
MAX_HORIZONTAL_GAP = 150.0
MIN_RULE_LENGTH = 30.0
MIN_RULE_SEPARATION = 8.0


@dataclass(frozen=True)
class TextLine:
    top: float
    x0: float
    x1: float
    text: str


@dataclass
class GeometryTarget:
    """A fill-in target recovered from page geometry."""

    page_number: int
    x0: float
    x1: float
    top: float
    bottom: float
    label: Optional[str]
    target_kind: str  # "rule" | "box"


def group_text_lines(words: list[dict]) -> list[TextLine]:
    """Group pdfplumber words into visual text lines (pure)."""
    rows: dict[int, list[dict]] = {}
    for w in words:
        rows.setdefault(round(w["top"], 0), []).append(w)
    lines: list[TextLine] = []
    for top, ws in sorted(rows.items()):
        ws_sorted = sorted(ws, key=lambda w: w["x0"])
        lines.append(
            TextLine(
                top=float(top),
                x0=min(w["x0"] for w in ws_sorted),
                x1=max(w["x1"] for w in ws_sorted),
                text=" ".join(w["text"] for w in ws_sorted),
            )
        )
    return lines


def associate_label(
    text_lines: list[TextLine],
    target_x0: float,
    target_x1: float,
    target_top: float,
    max_vertical_gap: float = MAX_VERTICAL_GAP,
    max_horizontal_gap: float = MAX_HORIZONTAL_GAP,
) -> Optional[str]:
    """Pure nearest-text association for a fill-in target.

    Preference: the closest text line fully above the target whose span
    overlaps the target's column range; otherwise the closest text line
    ending just left of the target on the same row. Returns None when
    nothing plausibly labels the target - never a guess.
    """
    best_above: Optional[tuple[float, str]] = None
    best_left: Optional[tuple[float, str]] = None
    for line in text_lines:
        if line.text == "":
            continue
        vertical_gap = target_top - line.top
        overlaps_column = line.x1 > target_x0 and line.x0 < target_x1
        if 0 < vertical_gap <= max_vertical_gap and overlaps_column:
            candidate = (vertical_gap, line.text)
            if best_above is None or candidate[0] < best_above[0]:
                best_above = candidate
        elif abs(vertical_gap) <= 2.0:
            horizontal_gap = target_x0 - line.x1
            if 0 < horizontal_gap <= max_horizontal_gap:
                candidate = (horizontal_gap, line.text)
                if best_left is None or candidate[0] < best_left[0]:
                    best_left = candidate
    if best_above is not None:
        return best_above[1]
    if best_left is not None:
        return best_left[1]
    return None


def _dedupe_hrules(
    entries: list[tuple[int, float, float, float, str, float]],
) -> list[tuple[int, float, float, float, str, float]]:
    """Drop near-duplicate rules (nested rect edges, double strokes). Pure."""
    kept: list[tuple[int, float, float, float, str, float]] = []
    for entry in sorted(entries, key=lambda e: (e[0], e[1], e[2], e[3])):
        dup = False
        for other in kept:
            if (
                entry[0] == other[0]
                and abs(entry[1] - other[1]) < MIN_RULE_SEPARATION
                and abs(entry[2] - other[2]) < MIN_RULE_SEPARATION
                and abs(entry[3] - other[3]) < MIN_RULE_SEPARATION
                and entry[4] == other[4]
            ):
                dup = True
                break
        if not dup:
            kept.append(entry)
    return kept


def extract_flattened_targets(
    pdf: "pdfplumber.PDF",
) -> list[GeometryTarget]:
    """Recover fill-in targets and their labels from a flattened form.

    Targets: long horizontal rules (write-on lines) and rectangles.
    Labels: nearest-text association, may be None.
    """
    targets: list[GeometryTarget] = []
    for page_number, page in enumerate(pdf.pages, start=1):
        text_lines = group_text_lines(page.extract_words() or [])

        rule_entries: list[tuple[int, float, float, float, str, float]] = []
        for line in page.lines:
            if abs(line["y0"] - line["y1"]) < 0.5:
                x0, x1 = sorted((line["x0"], line["x1"]))
                top = page.height - line["y1"]  # to top-origin
                rule_entries.append((page_number, x0, x1, top, "rule", 3.0))
        for rect in page.rects:
            x0, x1 = sorted((rect["x0"], rect["x1"]))
            top = page.height - rect["y1"]  # top edge, top-origin
            bottom = page.height - rect["y0"]
            rule_entries.append((page_number, x0, x1, top, "box", bottom - top))

        for page_no, x0, x1, top, kind, height in _dedupe_hrules(rule_entries):
            width = x1 - x0
            if width < MIN_RULE_LENGTH:
                continue
            label = associate_label(text_lines, x0, x1, top)
            targets.append(
                GeometryTarget(
                    page_number=page_no,
                    x0=round(x0, 1),
                    x1=round(x1, 1),
                    top=round(top, 1),
                    bottom=round(top + height, 1),
                    label=label,
                    target_kind=kind,
                )
            )
    return targets


def label_association_tool() -> str:
    return PDFPLUMBER_TOOL
