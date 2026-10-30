"""requiredStatus classification tests: all four values, per source layer."""

from __future__ import annotations

import pytest

from pdf_extraction.model import (
    RequiredStatus,
    RequirementLevel,
    SourceLayer,
)
from pdf_extraction.required_status import (
    classify_required_status,
    detect_label_cues,
    derive_requirement_level,
)


class TestClassifyRequiredStatus:
    def test_author_flag_set(self):
        assert (
            classify_required_status(SourceLayer.ACROFORM, True, "Name")
            is RequiredStatus.AUTHOR_DECLARED_REQUIRED
        )

    def test_author_flag_unset_is_not_marked(self):
        assert (
            classify_required_status(SourceLayer.ACROFORM, False, "Name")
            is RequiredStatus.NOT_MARKED_REQUIRED
        )

    def test_author_flag_unset_is_never_optional(self):
        # Research section 2.3: absence of the mark is not "optional".
        status = classify_required_status(SourceLayer.XFA, False, "Name")
        assert status is RequiredStatus.NOT_MARKED_REQUIRED
        assert status is not RequiredStatus.UNKNOWN

    def test_geometry_cue_asterisk_infers_required(self):
        assert (
            classify_required_status(SourceLayer.LAYOUT_GEOMETRY, None, "Name*")
            is RequiredStatus.INFERRED_REQUIRED
        )

    def test_geometry_no_cue_is_unknown(self):
        assert (
            classify_required_status(SourceLayer.LAYOUT_GEOMETRY, None, "Name")
            is RequiredStatus.UNKNOWN
        )

    def test_ocr_cue_wording_infers_required(self):
        assert (
            classify_required_status(SourceLayer.OCR, None, "must be completed")
            is RequiredStatus.INFERRED_REQUIRED
        )

    def test_author_layer_requires_explicit_flag(self):
        with pytest.raises(ValueError):
            classify_required_status(SourceLayer.ACROFORM, None, "Name")


class TestDeriveRequirementLevel:
    @pytest.mark.parametrize(
        "status,expected",
        [
            (RequiredStatus.AUTHOR_DECLARED_REQUIRED, RequirementLevel.REQUIRED),
            (RequiredStatus.INFERRED_REQUIRED, RequirementLevel.REQUIRED),
        ],
    )
    def test_required_statuses_map_to_required(
        self, status: RequiredStatus, expected: RequirementLevel
    ):
        assert derive_requirement_level(status, "Name") is expected

    def test_not_marked_without_cues_is_unknown(self):
        # The honesty core: no mark, no wording -> unknown, not optional.
        assert (
            derive_requirement_level(RequiredStatus.NOT_MARKED_REQUIRED, "Name")
            is RequirementLevel.UNKNOWN
        )

    def test_optional_wording_refines_not_marked(self):
        assert (
            derive_requirement_level(
                RequiredStatus.NOT_MARKED_REQUIRED, "Middle name (optional)"
            )
            is RequirementLevel.OPTIONAL
        )

    def test_conditional_wording_refines_not_marked(self):
        assert (
            derive_requirement_level(
                RequiredStatus.NOT_MARKED_REQUIRED,
                "Only fill out if your dog's rabies vaccine information has changed",
            )
            is RequirementLevel.CONDITIONALLY_REQUIRED
        )

    def test_unknown_status_stays_unknown(self):
        assert (
            derive_requirement_level(RequiredStatus.UNKNOWN, "Name")
            is RequirementLevel.UNKNOWN
        )

    def test_conditional_beats_optional_when_both_present(self):
        assert (
            derive_requirement_level(
                RequiredStatus.NOT_MARKED_REQUIRED,
                "optional, only fill out if needed",
            )
            is RequirementLevel.CONDITIONALLY_REQUIRED
        )


class TestCueDetection:
    @pytest.mark.parametrize(
        "text,cue",
        [
            ("Name*", "required"),
            ("* required field", "required"),
            ("Applicant must sign", "required"),
            ("Daytime phone", None),
            ("(optional)", "optional"),
            ("If applicable", "conditional"),
        ],
    )
    def test_cues(self, text: str, cue: str | None):
        cues = detect_label_cues(text)
        if cue is None:
            assert cues == set()
        else:
            assert cue in cues
