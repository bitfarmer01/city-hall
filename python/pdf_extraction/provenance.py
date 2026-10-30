"""Provenance record builders (research section 6).

Every field record carries how it was extracted and with what confidence.
Confidence constants are declared heuristics: native author metadata is
exact (1.0); geometry- and cue-based inference is explicitly sub-1.0.
"""

from __future__ import annotations

import importlib.metadata

from pdf_extraction.model import Provenance, SourceLayer

# Declared heuristic confidences. These are not measurements - they are
# fixed, documented grades for the epistemic strength of each layer.
CONFIDENCE_AUTHOR_METADATA = 1.0
CONFIDENCE_CUE_INFERENCE = 0.7
CONFIDENCE_GEOMETRY_INFERENCE = 0.6


def tool_version(module_name: str) -> str:
    """Return 'name==version' for an installed distribution, or 'name==?'.

    Raises nothing: an unknown version is recorded as '?', not invented.
    """
    dist_name = {
        "pypdf": "pypdf",
        "pdfplumber": "pdfplumber",
        "xml.etree.ElementTree": "python-stdlib",
    }.get(module_name, module_name)
    try:
        version = importlib.metadata.version(dist_name)
    except importlib.metadata.PackageNotFoundError:
        version = "?"
    return f"{dist_name}=={version}"


PYPDF_TOOL = tool_version("pypdf")
PDFPLUMBER_TOOL = tool_version("pdfplumber")
STDLIB_XML_TOOL = "python-stdlib+xml.etree"


def acroform_provenance() -> Provenance:
    return Provenance(
        source_layer=SourceLayer.ACROFORM,
        tool=PYPDF_TOOL,
        confidence=CONFIDENCE_AUTHOR_METADATA,
    )


def xfa_provenance() -> Provenance:
    return Provenance(
        source_layer=SourceLayer.XFA,
        tool=STDLIB_XML_TOOL,
        confidence=CONFIDENCE_AUTHOR_METADATA,
    )


def geometry_provenance() -> Provenance:
    return Provenance(
        source_layer=SourceLayer.LAYOUT_GEOMETRY,
        tool=PDFPLUMBER_TOOL,
        confidence=CONFIDENCE_GEOMETRY_INFERENCE,
        note="flattened form: labels and boxes recovered from page geometry; no author metadata exists",
    )


def label_association_provenance(tool: str) -> Provenance:
    return Provenance(
        source_layer=SourceLayer.LAYOUT_GEOMETRY,
        tool=tool,
        confidence=CONFIDENCE_GEOMETRY_INFERENCE,
        note="visible label associated by nearest-text geometry",
    )
