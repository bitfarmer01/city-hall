"""requiredStatus classification and the derived semantic level.

Two related but distinct views, both four-valued:

- requiredStatus (canonical, locked decision 6): what the form itself says
  about requiredness. AcroForm/XFA layers answer from author metadata
  (field flags / declarative markers); OCR and layout-geometry layers
  answer from presentation cues only.
- requirementLevel (derived rendering hint): required |
  conditionally_required | optional | unknown, from requiredStatus plus
  visible-label wording.

Never collapses to a boolean; absence of a mark is never read as
"optional" (research section 2.3).
"""

from __future__ import annotations

import re
from typing import Optional

from pdf_extraction.model import (
    RequiredStatus,
    RequirementLevel,
    SourceLayer,
)

# Author-metadata layers: the flag/marker is authoritative either way.
_AUTHOR_LAYERS = frozenset({SourceLayer.ACROFORM, SourceLayer.XFA})

# Presentation-cue layers: no author metadata exists at all.
_CUE_LAYERS = frozenset({SourceLayer.LAYOUT_GEOMETRY, SourceLayer.OCR})

_REQUIRED_CUE = re.compile(r"\*|\brequired\b|\bmust\b", re.IGNORECASE)
_OPTIONAL_CUE = re.compile(r"\boptional\b", re.IGNORECASE)
_CONDITIONAL_CUE = re.compile(
    r"\bif applicable\b|\bonly fill out\b|\bif needed\b|\bonly if\b|\bas needed\b",
    re.IGNORECASE,
)


def detect_label_cues(label_text: Optional[str]) -> set[str]:
    """Pure cue scan over visible label text.

    Returns a set drawn from {"required", "optional", "conditional"}.
    Cue detection is regex-based on the printed label only - never on
    assumptions about what the agency "probably" meant.
    """
    if not label_text:
        return set()
    cues: set[str] = set()
    if _REQUIRED_CUE.search(label_text):
        cues.add("required")
    if _OPTIONAL_CUE.search(label_text):
        cues.add("optional")
    if _CONDITIONAL_CUE.search(label_text):
        cues.add("conditional")
    return cues


def classify_required_status(
    source_layer: SourceLayer,
    required_flag: Optional[bool],
    label_text: Optional[str],
) -> RequiredStatus:
    """Pure requiredStatus classification (research section 2.3).

    required_flag is the author's declarative mark (AcroForm Required bit,
    XFA required attribute) or None where no such metadata exists.
    """
    if source_layer in _AUTHOR_LAYERS:
        if required_flag is None:
            raise ValueError(
                "author layer requires an explicit required_flag (True/False)"
            )
        return (
            RequiredStatus.AUTHOR_DECLARED_REQUIRED
            if required_flag
            else RequiredStatus.NOT_MARKED_REQUIRED
        )
    if source_layer in _CUE_LAYERS:
        # Presentation evidence only: cues raise inferred_required;
        # otherwise we simply do not know.
        if "required" in detect_label_cues(label_text):
            return RequiredStatus.INFERRED_REQUIRED
        return RequiredStatus.UNKNOWN
    raise ValueError(f"unhandled source layer: {source_layer}")


def derive_requirement_level(
    required_status: RequiredStatus,
    label_text: Optional[str],
) -> RequirementLevel:
    """Pure semantic-level derivation (the rendering hint).

    Order of authority: author-declared requiredness wins over printed
    wording; printed wording (optional / conditional cues) refines
    not_marked_required; absence of any mark is never silently "optional".
    """
    cues = detect_label_cues(label_text)

    if required_status is RequiredStatus.AUTHOR_DECLARED_REQUIRED:
        return RequirementLevel.REQUIRED
    if required_status is RequiredStatus.INFERRED_REQUIRED:
        return RequirementLevel.REQUIRED

    if "conditional" in cues:
        return RequirementLevel.CONDITIONALLY_REQUIRED
    if "optional" in cues:
        return RequirementLevel.OPTIONAL

    if required_status is RequiredStatus.NOT_MARKED_REQUIRED:
        # Honest default: no author mark and no wording evidence.
        return RequirementLevel.UNKNOWN
    return RequirementLevel.UNKNOWN
