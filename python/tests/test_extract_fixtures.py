"""End-to-end extraction tests against the four committed fixture PDFs."""

from __future__ import annotations

import pytest

from pdf_extraction.extract import extract_form
from pdf_extraction.model import (
    FillableClass,
    RequiredStatus,
    RequirementLevel,
    SourceLayer,
)

from conftest import fixture_pdf

CAPTURED_AT = "2026-10-30T17:11:00Z"

EXPECTED_SHA256 = {
    "pw1.pdf": "a68fd0c754fef1f4e473e0d694f961e5be31f5d611e43005b25c4ccb487cdb99",
    "birth1.pdf": "be95585389a798e278518c1a37cb7176ca537dc60388d0b52baeb1be1aafb54d",
    "premium-birth.pdf": (
        "e515d15e176e1c15ccecef07159e76b4d0b5f3832d3ec9477e71185fb18e10ce"
    ),
    "dog-license.pdf": (
        "77c432585a0c80d0e648876858891eef6e538d63f36c132c0cdecbcbcccde834"
    ),
}


@pytest.fixture(scope="module")
def pw1():
    return extract_form(
        fixture_pdf("pw1.pdf"),
        "https://www.nyc.gov/assets/buildings/pdf/pw1.pdf",
        "buildings",
        CAPTURED_AT,
        form_number="PW1",
    )


@pytest.fixture(scope="module")
def birth1():
    return extract_form(
        fixture_pdf("birth1.pdf"),
        "https://www.nyc.gov/assets/doh/downloads/pdf/vr/birth1.pdf",
        "dohmh",
        CAPTURED_AT,
    )


@pytest.fixture(scope="module")
def dog_license():
    return extract_form(
        fixture_pdf("dog-license.pdf"),
        "https://www.nyc.gov/assets/doh/downloads/pdf/vet/vet-doglicense-form.pdf",
        "dohmh",
        CAPTURED_AT,
    )


class TestPW1Hybrid:
    def test_class(self, pw1):
        assert pw1.form.fillable_class is FillableClass.HYBRID

    def test_form_id_and_number(self, pw1):
        assert pw1.form.form_id == "form:buildings:pw1"
        assert pw1.form.form_number == "PW1"
        assert pw1.form.agency == "buildings"

    def test_xfa_fields_extracted(self, pw1):
        # 660 fields from the XFA template packet (verified smoke run).
        assert len(pw1.fields) >= 500

    def test_provenance_layer_is_xfa(self, pw1):
        assert all(f.provenance.source_layer is SourceLayer.XFA for f in pw1.fields)

    def test_honest_required_status(self, pw1):
        # No author marks anywhere on this form: not_marked_required, and
        # requirementLevel stays unknown (no visible required cues in the
        # XFA tooltips for the bulk of fields).
        assert all(
            f.required_status is RequiredStatus.NOT_MARKED_REQUIRED
            for f in pw1.fields
        )

    def test_visible_labels_from_tooltips(self, pw1):
        labels = [f.visible_label for f in pw1.fields if f.visible_label]
        assert any("Sign Hanger" in label for label in labels)
        assert len(labels) >= 300

    def test_bbox_units(self, pw1):
        boxed = [f for f in pw1.fields if f.bbox is not None]
        assert boxed, "XFA fields should carry template geometry"
        assert all(f.bbox["unit"] == "mm" for f in boxed)


class TestBirthFormsAcroform:
    def test_class(self, birth1):
        assert birth1.form.fillable_class is FillableClass.ACROFORM

    def test_unnumbered_form_id(self, birth1):
        assert birth1.form.form_id == "form:dohmh:unnumbered-be955853"
        assert birth1.form.form_number is None

    def test_field_count(self, birth1):
        assert len(birth1.fields) == 34

    def test_native_names(self, birth1):
        names = {f.native_name for f in birth1.fields}
        assert "S1 First name" in names

    def test_visible_labels_from_geometry(self, birth1):
        labels = [f.visible_label for f in birth1.fields if f.visible_label]
        assert any("FIRST NAME" in label.upper() for label in labels)

    def test_widget_bboxes(self, birth1):
        boxed = [f for f in birth1.fields if f.bbox is not None]
        assert len(boxed) == 34
        assert all(f.bbox["unit"] == "pt" for f in boxed)
        assert all(
            f.bbox["coordSystem"] == "pdf-user-space-bottom-left" for f in boxed
        )

    def test_premium_birth_extracts(self):
        ex = extract_form(
            fixture_pdf("premium-birth.pdf"),
            "https://www.nyc.gov/assets/doh/downloads/pdf/vr/premium-birth-certificate-app.pdf",
            "dohmh",
            CAPTURED_AT,
        )
        assert ex.form.fillable_class is FillableClass.ACROFORM
        assert len(ex.fields) == 33
        assert any(
            f.visible_label and "premium" in f.visible_label.lower()
            for f in ex.fields
        )


class TestDogLicenseFlattened:
    def test_class(self, dog_license):
        assert dog_license.form.fillable_class is FillableClass.FLATTENED

    def test_geometry_fields(self, dog_license):
        assert len(dog_license.fields) >= 200

    def test_provenance_layer_is_layout_geometry(self, dog_license):
        assert all(
            f.provenance.source_layer is SourceLayer.LAYOUT_GEOMETRY
            for f in dog_license.fields
        )

    def test_known_labels(self, dog_license):
        labels = [f.visible_label for f in dog_license.fields if f.visible_label]
        assert len(labels) >= 100
        for expected in ["First Name", "Last Name", "E-mail", "Primary Breed"]:
            assert any(expected in label for label in labels), expected

    def test_status_unknown_never_optional(self, dog_license):
        assert all(
            f.required_status is RequiredStatus.UNKNOWN for f in dog_license.fields
        )
        assert all(
            f.requirement_level is not RequirementLevel.OPTIONAL
            or f.required_status is RequiredStatus.UNKNOWN
            for f in dog_license.fields
        )

    def test_conditional_cues_detected(self, dog_license):
        conditional = [
            f
            for f in dog_license.fields
            if f.requirement_level is RequirementLevel.CONDITIONALLY_REQUIRED
        ]
        assert conditional, "the rabies section says 'Only fill out if'"
        assert any(
            f.visible_label and "Only fill out if" in f.visible_label
            for f in conditional
        )


class TestSnapshotAndIntegrity:
    def test_snapshot_hash(self, pw1):
        snap = pw1.snapshot
        assert snap.sha256 == EXPECTED_SHA256["pw1.pdf"]
        assert snap.method == "http_fetch"
        assert snap.http_status == 200
        assert snap.captured_at == CAPTURED_AT
        assert snap.url.startswith("https://www.nyc.gov/assets/buildings/")

    @pytest.mark.parametrize(
        "name,form_number",
        [
            ("pw1.pdf", "PW1"),
            ("birth1.pdf", None),
            ("premium-birth.pdf", None),
            ("dog-license.pdf", None),
        ],
    )
    def test_every_fixture_hashes_to_manifest(self, name, form_number):
        ex = extract_form(
            fixture_pdf(name),
            "https://example.gov/form.pdf",
            "dohmh",
            CAPTURED_AT,
            form_number=form_number,
        )
        assert ex.snapshot.sha256 == EXPECTED_SHA256[name]
        assert ex.form.snapshot_id == ex.snapshot.id

    def test_field_ids_unique_and_linked(self, pw1, dog_license):
        for ex in (pw1, dog_license):
            ids = [f.field_id for f in ex.fields]
            assert len(ids) == len(set(ids))
            assert all(f.form_id == ex.form.form_id for f in ex.fields)

    def test_field_id_hashes_not_names(self, dog_license):
        # hash8 of nativeName+page+rect, not the raw text.
        for fld in dog_license.fields:
            assert fld.field_id.startswith("fld:")
            suffix = fld.field_id.split(":")[-1]
            assert len(suffix) == 8 and suffix.isalnum()
            assert " " not in suffix

    def test_determinism_same_input_same_output(self, dog_license):
        again = extract_form(
            fixture_pdf("dog-license.pdf"),
            "https://www.nyc.gov/assets/doh/downloads/pdf/vet/vet-doglicense-form.pdf",
            "dohmh",
            CAPTURED_AT,
        )
        assert again.fields == dog_license.fields
        assert again.form.form_id == dog_license.form.form_id
        assert again.snapshot.sha256 == dog_license.snapshot.sha256
