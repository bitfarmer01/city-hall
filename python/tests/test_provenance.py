"""Provenance record tests: builders, grades, and JSON round-trip."""

from __future__ import annotations

import json

import pytest

from pdf_extraction.model import (
    FormField,
    Provenance,
    RequiredStatus,
    RequirementLevel,
    SourceLayer,
)
from pdf_extraction.provenance import (
    CONFIDENCE_AUTHOR_METADATA,
    CONFIDENCE_CUE_INFERENCE,
    CONFIDENCE_GEOMETRY_INFERENCE,
    acroform_provenance,
    geometry_provenance,
    label_association_provenance,
    xfa_provenance,
)


class TestBuilders:
    def test_acroform_builder(self):
        prov = acroform_provenance()
        assert prov.source_layer is SourceLayer.ACROFORM
        assert prov.confidence == CONFIDENCE_AUTHOR_METADATA
        assert prov.tool.startswith("pypdf==")

    def test_xfa_builder(self):
        prov = xfa_provenance()
        assert prov.source_layer is SourceLayer.XFA
        assert prov.confidence == CONFIDENCE_AUTHOR_METADATA
        assert prov.tool == "python-stdlib+xml.etree"

    def test_geometry_builder(self):
        prov = geometry_provenance()
        assert prov.source_layer is SourceLayer.LAYOUT_GEOMETRY
        assert prov.confidence == CONFIDENCE_GEOMETRY_INFERENCE
        assert prov.tool.startswith("pdfplumber==")
        assert prov.note  # honesty: states what geometry extraction is

    def test_label_association_builder(self):
        prov = label_association_provenance("pdfplumber==0.11.10+assoc")
        assert prov.source_layer is SourceLayer.LAYOUT_GEOMETRY
        assert prov.tool == "pdfplumber==0.11.10+assoc"

    def test_pinned_tool_versions(self):
        # The pinned toolchain appears in the tool string so the catalog
        # can reason about extraction reproducibility.
        assert acroform_provenance().tool == "pypdf==6.21.4"
        assert geometry_provenance().tool == "pdfplumber==0.11.10"


@pytest.mark.parametrize(
    "prov",
    [
        acroform_provenance(),
        xfa_provenance(),
        geometry_provenance(),
        label_association_provenance("pdfplumber==0.11.10+assoc"),
        Provenance(source_layer=SourceLayer.OCR, tool="tesseract==5", confidence=0.4),
    ],
)
def test_provenance_json_round_trip(prov: Provenance):
    raw = json.loads(json.dumps(prov.to_dict()))
    restored = Provenance.from_dict(raw)
    assert restored == prov


def test_form_field_json_round_trip():
    fld = FormField(
        field_id="fld:form:buildings:pw1:1a2b3c4d",
        form_id="form:buildings:pw1",
        native_name="TopmostSubform.Page1.fld_1",
        visible_label="Sign Hanger",
        field_type="checkbox",
        required_status=RequiredStatus.NOT_MARKED_REQUIRED,
        requirement_level=RequirementLevel.UNKNOWN,
        provenance=xfa_provenance(),
        label_provenance=None,
        bbox={"unit": "mm", "coordSystem": "xfa-template", "x": 40.48, "y": 3.7},
        options=["Yes", "No"],
        semantic_type=None,
        notes=None,
    )
    raw = fld.to_dict()
    restored = FormField.from_dict(json.loads(json.dumps(raw)))
    assert restored == fld
    # Enums serialize to their string values for the TypeScript side.
    assert raw["requiredStatus"] == "not_marked_required"
    assert raw["requirementLevel"] == "unknown"
    assert raw["provenance"]["sourceLayer"] == "xfa"
    assert raw["options"] == ["Yes", "No"]


def test_confidence_grades_ordered():
    assert CONFIDENCE_AUTHOR_METADATA > CONFIDENCE_CUE_INFERENCE
    assert CONFIDENCE_CUE_INFERENCE > CONFIDENCE_GEOMETRY_INFERENCE
