"""The PDF extraction pipeline (research section 2.4).

Native first: AcroForm field dictionaries (pypdf), XFA template XML
(stdlib), then geometry (pdfplumber). OCR is out of scope for D3a - a
scanned form reports zero fields with an explicit note rather than a
guess. Everything emits catalog JSON per the research sidecar schema.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import pdfplumber
import pypdf

from pdf_extraction import geometry, provenance
from pdf_extraction.classify import PdfProbe, detect_fillable_class
from pdf_extraction.model import (
    ExtractedForm,
    FillableClass,
    Form,
    FormField,
    SourceLayer,
    SourceSnapshot,
)
from pdf_extraction.required_status import (
    classify_required_status,
    derive_requirement_level,
)
from pdf_extraction.xfa import extract_xfa_template_bytes, parse_xfa_template

SCHEMA_VERSION = "d3a.1"

# AcroForm /Ff Required flag (PDF 32000-1:2008, table 220, bit position 1).
FF_REQUIRED_BIT = 2
# AcroForm /Ff Radio flag (bit position 15) distinguishes radio groups
# from checkboxes within /Btn fields.
FF_RADIO_BIT = 32768

_FT_TYPE_MAP = {
    "/Tx": "text",
    "/Ch": "choice",
    "/Sig": "signature",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_form_id(agency: str, form_number: Optional[str], sha256: str) -> str:
    """form:{agency}:{formNumber}v{revision} when both parts are known.

    Revision is not printed in machine-readable form on any of the three
    fixture forms, and no invented revisions: without a verified revision
    the ID is form:{agency}:{formNumber} (or an unnumbered fallback).
    """
    slug = (form_number or f"unnumbered-{sha256[:8]}").strip()
    slug = slug.replace(" ", "-").lower()
    return f"form:{agency}:{slug}"


def probe_pdf(reader: "pypdf.PdfReader", pdf: "pdfplumber.PDF") -> PdfProbe:
    """Gather classification signals by reading the PDF once."""
    has_acroform = False
    xfa_present = False
    n_fields = 0
    try:
        root = reader.trailer["/Root"]
        acro = root.get("/AcroForm")
        if acro is not None:
            has_acroform = True
            acro_obj = acro.get_object()
            xfa_present = acro_obj.get("/XFA") is not None
            fields = acro_obj.get("/Fields")
            if fields is not None:
                n_fields = len(fields.get_object())
    except Exception:
        # A malformed catalog is still classifiable from the other signals.
        pass
    char_count = sum(len(page.chars) for page in pdf.pages)
    image_count = sum(len(page.images) for page in pdf.pages)
    return PdfProbe(
        has_acroform=has_acroform,
        xfa_present=xfa_present,
        n_acroform_fields=n_fields,
        char_count=char_count,
        image_count=image_count,
        n_pages=len(pdf.pages),
    )


def _widget_rects(reader: "pypdf.PdfReader") -> dict[str, tuple[int, list[float]]]:
    """Map fully-qualified field name -> (page_no, /Rect) for widgets.

    Only the first widget per field is kept; multi-widget fields are rare
    in the corpus and noted when found.
    """
    rects: dict[str, tuple[int, list[float]]] = {}
    for page_no, page in enumerate(reader.pages, start=1):
        annots = page.get("/Annots")
        if annots is None:
            continue
        for ref in annots.get_object():
            obj = ref.get_object()
            if obj.get("/Subtype") != "/Widget":
                continue
            parts: list[str] = []
            node: Any = obj
            while node is not None:
                t = node.get("/T")
                if t:
                    parts.append(str(t))
                parent = node.get("/Parent")
                node = parent.get_object() if parent is not None else None
            fq = ".".join(reversed(parts))
            rect = [float(v) for v in obj["/Rect"]]
            if fq and fq not in rects:
                rects[fq] = (page_no, rect)
    return rects


def _acroform_field_type(ft: Optional[str], ff: Optional[int]) -> str:
    if ft == "/Btn":
        return "radio" if (ff is not None and int(ff) & FF_RADIO_BIT) else "checkbox"
    if ft == "/Tx":
        return "text"
    return _FT_TYPE_MAP.get(ft or "", "text")


def _field_id(form_id: str, native_name: Optional[str], page: Optional[int], bbox: Any, seen: dict[str, int]) -> str:
    basis = f"{native_name}|{page}|{bbox}"
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:8]
    base = f"fld:{form_id}:{digest}"
    count = seen.get(base, 0)
    seen[base] = count + 1
    return base if count == 0 else f"{base}-{count}"


def _label_for_rect(
    page_lines: dict[int, list[geometry.TextLine]],
    page_no: int,
    rect: list[float],
    page_height: float,
) -> Optional[str]:
    """Visible label for an AcroForm widget rect (bottom-origin PDF coords)."""
    lines = page_lines.get(page_no)
    if lines is None:
        return None
    x0, _y0, x1, y1 = rect
    top = page_height - y1
    return geometry.associate_label(lines, x0, x1, top)


def _plumber_page_lines(pdf: "pdfplumber.PDF") -> dict[int, list[geometry.TextLine]]:
    out: dict[int, list[geometry.TextLine]] = {}
    for page_no, page in enumerate(pdf.pages, start=1):
        out[page_no] = geometry.group_text_lines(page.extract_words() or [])
    return out


def extract_acroform_fields(
    reader: "pypdf.PdfReader",
    pdf: "pdfplumber.PDF",
    form_id: str,
    seen: dict[str, int],
) -> list[FormField]:
    """Read fields native-first from AcroForm field dictionaries."""
    raw_fields = reader.get_fields() or {}
    rects = _widget_rects(reader)
    page_lines = _plumber_page_lines(pdf)
    page_heights: dict[int, float] = {
        page_no: float(page.height) for page_no, page in enumerate(pdf.pages, start=1)
    }
    out: list[FormField] = []
    for name, raw in raw_fields.items():
        ft = raw.get("/FT")
        if ft is None:
            # Degenerate container (XFA shells) - carries no fillable field.
            continue
        ff = raw.get("/Ff")
        required_flag = bool(int(ff) & FF_REQUIRED_BIT) if ff is not None else False
        field_type = _acroform_field_type(str(ft), ff)
        options = [str(s) for s in (raw.get("/_States_") or [])]
        widget = rects.get(name)
        bbox = None
        visible_label = None
        page_no: Optional[int] = None
        if widget is not None:
            page_no, rect = widget
            bbox = {
                "unit": "pt",
                "coordSystem": "pdf-user-space-bottom-left",
                "x": round(rect[0], 2),
                "y": round(rect[1], 2),
                "w": round(rect[2] - rect[0], 2),
                "h": round(rect[3] - rect[1], 2),
            }
            visible_label = _label_for_rect(
                page_lines, page_no, rect, page_heights.get(page_no, 0.0)
            )
        required_status = classify_required_status(
            SourceLayer.ACROFORM, required_flag, visible_label
        )
        level = derive_requirement_level(required_status, visible_label)
        prov = provenance.acroform_provenance()
        label_prov = (
            provenance.label_association_provenance(provenance.PDFPLUMBER_TOOL)
            if visible_label is not None
            else None
        )
        out.append(
            FormField(
                field_id=_field_id(form_id, name, page_no, bbox, seen),
                form_id=form_id,
                native_name=name,
                visible_label=visible_label,
                field_type=field_type,
                required_status=required_status,
                requirement_level=level,
                provenance=prov,
                label_provenance=label_prov,
                bbox=bbox,
                options=options,
            )
        )
    out.sort(key=lambda f: (f.bbox is None, f.bbox["y"] if f.bbox else 0, f.native_name or ""))
    return out


def extract_xfa_fields(
    reader: "pypdf.PdfReader",
    form_id: str,
    seen: dict[str, int],
) -> list[FormField]:
    """Read fields from the XFA template packet, when present."""
    try:
        acro = reader.trailer["/Root"]["/AcroForm"].get_object()
        template_bytes = extract_xfa_template_bytes(acro.get("/XFA"))
    except Exception:
        template_bytes = None
    if template_bytes is None:
        return []
    candidates = parse_xfa_template(template_bytes)
    out: list[FormField] = []
    for cand in candidates:
        required_status = classify_required_status(
            SourceLayer.XFA, cand.required_flag, cand.visible_label
        )
        level = derive_requirement_level(required_status, cand.visible_label)
        out.append(
            FormField(
                field_id=_field_id(
                    form_id, cand.native_name, None, cand.bbox, seen
                ),
                form_id=form_id,
                native_name=cand.native_name,
                visible_label=cand.visible_label,
                field_type=cand.ui_kind,
                required_status=required_status,
                requirement_level=level,
                provenance=provenance.xfa_provenance(),
                bbox=cand.bbox,
                options=cand.options,
            )
        )
    return out


def extract_flattened_fields(
    pdf: "pdfplumber.PDF",
    form_id: str,
    seen: dict[str, int],
) -> list[FormField]:
    """Recover fill-in targets from a flattened form's page geometry."""
    targets = geometry.extract_flattened_targets(pdf)
    out: list[FormField] = []
    for target in targets:
        bbox = {
            "unit": "pt",
            "coordSystem": "top-left",
            "x": target.x0,
            "y": target.top,
            "w": round(target.x1 - target.x0, 1),
            "h": round(target.bottom - target.top, 1),
        }
        required_status = classify_required_status(
            SourceLayer.LAYOUT_GEOMETRY, None, target.label
        )
        level = derive_requirement_level(required_status, target.label)
        out.append(
            FormField(
                field_id=_field_id(
                    form_id, target.label, target.page_number, bbox, seen
                ),
                form_id=form_id,
                native_name=None,
                visible_label=target.label,
                field_type="text",
                required_status=required_status,
                requirement_level=level,
                provenance=provenance.geometry_provenance(),
                label_provenance=(
                    provenance.label_association_provenance(
                        provenance.PDFPLUMBER_TOOL
                    )
                    if target.label is not None
                    else None
                ),
                bbox=bbox,
            )
        )
    return out


def extract_form(
    path: str | Path,
    source_url: str,
    agency: str,
    captured_at: str,
    form_number: Optional[str] = None,
    http_status: Optional[int] = 200,
) -> ExtractedForm:
    """Extract one PDF into a full catalog record set.

    Raises on unreadable PDFs - a broken capture must fail loudly, never
    produce a silently empty catalog.
    """
    pdf_path = Path(path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"fixture PDF not found: {pdf_path}")
    sha256 = sha256_file(pdf_path)
    form_id = build_form_id(agency, form_number, sha256)

    reader = pypdf.PdfReader(str(pdf_path), strict=False)
    with pdfplumber.open(str(pdf_path)) as pdf:
        probe = probe_pdf(reader, pdf)
        fillable_class = detect_fillable_class(probe)
        seen: dict[str, int] = {}
        fields: list[FormField] = []
        notes: Optional[str] = None

        if fillable_class is FillableClass.ACROFORM:
            fields = extract_acroform_fields(reader, pdf, form_id, seen)
        elif fillable_class in (FillableClass.XFA, FillableClass.HYBRID):
            fields = extract_xfa_fields(reader, form_id, seen)
            if not fields:
                notes = (
                    "XFA form model could not be parsed from the template "
                    "packet; field cataloging needs the XFA template parser"
                )
            elif fillable_class is FillableClass.HYBRID:
                notes = (
                    "hybrid XFA/AcroForm: fields from the XFA template "
                    f"packet; AcroForm dictionary holds {probe.n_acroform_fields} "
                    "container entries"
                )
        elif fillable_class is FillableClass.FLATTENED:
            fields = extract_flattened_fields(pdf, form_id, seen)
        else:  # SCANNED
            notes = (
                "scanned/image-only form: no text layer; field extraction "
                "requires OCR, which D3a does not run"
            )
            fields = []

        form_title = None
        try:
            meta = reader.metadata
            form_title = str(meta.title) if meta and meta.title else None
        except Exception:
            form_title = None
        if not form_title:
            form_title = form_number or pdf_path.stem

        form = Form(
            form_id=form_id,
            agency=agency,
            form_number=form_number,
            title=form_title,
            source_url=source_url,
            sha256=sha256,
            pages=probe.n_pages,
            fillable_class=fillable_class,
            snapshot_id=None,
            notes=notes,
        )
        snapshot = SourceSnapshot(
            sha256=sha256,
            url=source_url,
            captured_at=captured_at,
            method="http_fetch",
            http_status=http_status,
            storage_path=str(pdf_path),
            notes="public-boundary capture; no authentication",
        )
        form.snapshot_id = snapshot.id
        return ExtractedForm(form=form, fields=fields, snapshot=snapshot)


def emit_catalog_json(extracted: ExtractedForm, indent: int = 2) -> str:
    """Serialize an extraction result with version stamps (AGENTS.md)."""
    import json

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    payload = extracted.to_catalog_dict(SCHEMA_VERSION, generated_at)
    return json.dumps(payload, indent=indent, ensure_ascii=False)
