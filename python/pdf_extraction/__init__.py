"""city-hall PDF extraction pipeline (D3a).

Reads NYC service PDF forms field by field - native first (AcroForm
dictionaries, XFA template XML), geometry for flattened forms - and emits
catalog JSON for the TypeScript side. See the data-model research
(art_mcM1Ssao) for the record schema.
"""

from pdf_extraction.model import (
    ExtractedForm,
    FillableClass,
    Form,
    FormField,
    Provenance,
    RequiredStatus,
    RequirementLevel,
    SourceLayer,
    SourceSnapshot,
)
from pdf_extraction.extract import emit_catalog_json, extract_form

__all__ = [
    "ExtractedForm",
    "FillableClass",
    "Form",
    "FormField",
    "Provenance",
    "RequiredStatus",
    "RequirementLevel",
    "SourceLayer",
    "SourceSnapshot",
    "emit_catalog_json",
    "extract_form",
]
