"""Data model for the PDF extraction pipeline.

Record shapes follow "Research - Data model and form extraction"
(art_mcM1Ssao, section 6): Form, FormField, SourceSnapshot. The schema.org
envelope is a downstream concern; this package emits the sidecar catalog
JSON that the TypeScript side consumes.

Honesty rules (locked decision 6): requiredStatus is a four-value enum, never
a boolean; unknown stays unknown; nothing here invents data the PDF does not
support.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class FillableClass(str, Enum):
    """How a PDF form is fillable (research section 2.1/2.4 step 2)."""

    ACROFORM = "acroform"
    XFA = "xfa"
    HYBRID = "hybrid"
    FLATTENED = "flattened"
    SCANNED = "scanned"


class RequiredStatus(str, Enum):
    """What the form itself says about requiredness (research section 2.3).

    author_declared_required - the author marked the field required
        (AcroForm Required flag, or a declarative XFA marker).
    not_marked_required - the author left no required mark. This is NOT
        "optional": agency instructions may still make it mandatory.
    inferred_required - no author metadata; requiredness inferred from
        presentation cues (asterisk, "required" wording) with lower
        confidence.
    unknown - no evidence either way.
    """

    AUTHOR_DECLARED_REQUIRED = "author_declared_required"
    NOT_MARKED_REQUIRED = "not_marked_required"
    INFERRED_REQUIRED = "inferred_required"
    UNKNOWN = "unknown"


class RequirementLevel(str, Enum):
    """Semantic rendering view derived from RequiredStatus + label cues.

    The catalog's canonical field is requiredStatus (locked decision 6);
    requirementLevel is a deterministic rendering hint for consumers that
    want required/conditionally-required/optional/unknown.
    """

    REQUIRED = "required"
    CONDITIONALLY_REQUIRED = "conditionally_required"
    OPTIONAL = "optional"
    UNKNOWN = "unknown"


class SourceLayer(str, Enum):
    """Where a field's authoritative metadata came from (research section 6).

    acroform | xfa | ocr are the research values. layout_geometry is an
    additive extension for flattened forms: labels and boxes recovered from
    page geometry (pdfplumber) without author metadata - the same epistemic
    grade as OCR (presentation evidence, no declared flags).
    """

    ACROFORM = "acroform"
    XFA = "xfa"
    OCR = "ocr"
    LAYOUT_GEOMETRY = "layout_geometry"


@dataclass
class Provenance:
    """Extraction method + confidence for one aspect of a field record."""

    source_layer: SourceLayer
    tool: str
    confidence: float
    note: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "sourceLayer": self.source_layer.value,
            "tool": self.tool,
            "confidence": self.confidence,
        }
        if self.note is not None:
            out["note"] = self.note
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Provenance":
        return cls(
            source_layer=SourceLayer(data["sourceLayer"]),
            tool=data["tool"],
            confidence=data["confidence"],
            note=data.get("note"),
        )


@dataclass
class SourceSnapshot:
    """Provenance record for a captured source file (research section 6)."""

    sha256: str
    url: str
    captured_at: str
    method: str = "http_fetch"
    http_status: Optional[int] = None
    storage_path: Optional[str] = None
    notes: Optional[str] = None

    @property
    def id(self) -> str:
        return f"snap:{self.sha256[:12]}"

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.id,
            "url": self.url,
            "capturedAt": self.captured_at,
            "method": self.method,
            "sha256": self.sha256,
        }
        if self.http_status is not None:
            out["httpStatus"] = self.http_status
        if self.storage_path is not None:
            out["storagePath"] = self.storage_path
        if self.notes is not None:
            out["notes"] = self.notes
        return out


@dataclass
class FormField:
    """One form field, per the research FormField record (section 6)."""

    field_id: str
    form_id: str
    native_name: Optional[str]
    visible_label: Optional[str]
    field_type: str
    required_status: RequiredStatus
    requirement_level: RequirementLevel
    provenance: Provenance
    label_provenance: Optional[Provenance] = None
    bbox: Optional[dict[str, Any]] = None
    options: list[str] = field(default_factory=list)
    semantic_type: Optional[str] = None
    notes: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.field_id,
            "formId": self.form_id,
            "nativeName": self.native_name,
            "visibleLabel": self.visible_label,
            "fieldType": self.field_type,
            "requiredStatus": self.required_status.value,
            "requirementLevel": self.requirement_level.value,
            "provenance": self.provenance.to_dict(),
        }
        if self.label_provenance is not None:
            out["labelProvenance"] = self.label_provenance.to_dict()
        if self.bbox is not None:
            out["bbox"] = self.bbox
        if self.options:
            out["options"] = self.options
        if self.semantic_type is not None:
            out["semanticType"] = self.semantic_type
        if self.notes is not None:
            out["notes"] = self.notes
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FormField":
        label_prov = data.get("labelProvenance")
        return cls(
            field_id=data["id"],
            form_id=data["formId"],
            native_name=data.get("nativeName"),
            visible_label=data.get("visibleLabel"),
            field_type=data["fieldType"],
            required_status=RequiredStatus(data["requiredStatus"]),
            requirement_level=RequirementLevel(data["requirementLevel"]),
            provenance=Provenance.from_dict(data["provenance"]),
            label_provenance=(
                Provenance.from_dict(label_prov) if label_prov else None
            ),
            bbox=data.get("bbox"),
            options=list(data.get("options") or []),
            semantic_type=data.get("semanticType"),
            notes=data.get("notes"),
        )


@dataclass
class Form:
    """One PDF form, per the research Form record (section 6).

    ID: form:{agency}:{formNumber}v{revision} when the revision is known;
    form:{agency}:{formNumber} when it is not (no invented revisions).
    """

    form_id: str
    agency: str
    form_number: Optional[str]
    title: str
    source_url: str
    sha256: str
    pages: int
    fillable_class: FillableClass
    revision_date: Optional[str] = None
    snapshot_id: Optional[str] = None
    notes: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.form_id,
            "agency": self.agency,
            "formNumber": self.form_number,
            "title": self.title,
            "sourceUrl": self.source_url,
            "sha256": self.sha256,
            "pages": self.pages,
            "fillableClass": self.fillable_class.value,
        }
        if self.revision_date is not None:
            out["revisionDate"] = self.revision_date
        if self.snapshot_id is not None:
            out["snapshotId"] = self.snapshot_id
        if self.notes is not None:
            out["notes"] = self.notes
        return out


@dataclass
class ExtractedForm:
    """Full extraction result: form record + its field records + snapshot."""

    form: Form
    fields: list[FormField]
    snapshot: SourceSnapshot

    def to_catalog_dict(self, schema_version: str, generated_at: str) -> dict[str, Any]:
        return {
            "schemaVersion": schema_version,
            "generatedAt": generated_at,
            "form": self.form.to_dict(),
            "fields": [f.to_dict() for f in self.fields],
            "snapshot": self.snapshot.to_dict(),
        }
