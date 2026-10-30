"""XFA template parsing (research section 2.2, XFA row).

XFA forms hide the real form model in an embedded XDP XML packet that
AcroForm tooling cannot interpret. This parser walks the XFA `template`
stream as XML and recovers, per field: the SOM-style native name, the
human-readable label (caption or tooltip), the UI kind, declared geometry
in millimetres, and any declarative required marker.

XFA fields carry no page assignment (that is decided at layout time), so
their bbox keeps template coordinates and page stays None - recorded
honestly, not guessed.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field as dataclass_field
from typing import Any, Optional

_XFA_NS = "{http://www.xfa.org/schema/xfa-template/"


@dataclass
class XfaField:
    native_name: str
    visible_label: Optional[str]
    ui_kind: str
    bbox: dict[str, Any]
    required_flag: bool
    options: list[str] = dataclass_field(default_factory=list)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _text_of(el: Any) -> Optional[str]:
    if el is None:
        return None
    text = "".join(el.itertext()).strip()
    return text or None


def _ui_kind(field_el: Any) -> str:
    ui = next(
        (c for c in field_el if _local(c.tag) == "ui"), None
    )
    if ui is None or len(ui) == 0:
        return "text"
    child = _local(ui[0].tag)
    return {
        "checkButton": "checkbox",
        "textEdit": "text",
        "numericEdit": "numeric",
        "dateTimeEdit": "date",
        "choiceList": "choice",
        "button": "button",
        "imageEdit": "image",
    }.get(child, "text")


def parse_xfa_template(template_xml: bytes) -> list[XfaField]:
    """Parse an XFA template packet into field candidates.

    Native names are built from the ancestor name chain (SOM-style:
    Page1.Group.Field). Radio groups (exclGroup) are emitted as radio
    fields with their choice items.
    """
    root = ET.fromstring(template_xml)
    if not root.tag.startswith(_XFA_NS):
        raise ValueError("not an XFA template packet")

    fields: list[XfaField] = []

    parent_map = {c: p for p in root.iter() for c in p}

    def full_name(el: Any) -> str:
        parts: list[str] = []
        node: Any = el
        while node is not None and isinstance(node.tag, str):
            name = node.get("name")
            if name:
                parts.append(name)
            node = parent_map.get(node)
        return ".".join(reversed(parts))

    def options_of(field_el: Any) -> list[str]:
        items = next(
            (c for c in field_el if _local(c.tag) == "items"), None
        )
        if items is None:
            return []
        return [
            t
            for t in (_text_of(item) for item in items if _local(item.tag) == "text")
            if t is not None
        ]

    def bbox_of(field_el: Any) -> dict[str, Any]:
        out: dict[str, Any] = {"unit": "mm", "coordSystem": "xfa-template"}
        for key in ("x", "y", "w", "h"):
            val = field_el.get(key)
            if val is None:
                continue
            try:
                # Template values may carry unit suffixes ("40.48mm").
                out[key] = float(re.sub(r"[^0-9.\-]", "", val))
            except ValueError:
                continue  # unparseable geometry: omit, never guess
        return out

    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        local = _local(el.tag)
        if local == "field":
            assist = next(
                (c for c in el if _local(c.tag) == "assist"), None
            )
            tooltip = (
                next(
                    (c for c in assist if _local(c.tag) == "toolTip"), None
                )
                if assist is not None
                else None
            )
            caption = next(
                (c for c in el if _local(c.tag) == "caption"), None
            )
            label = _text_of(tooltip) or _text_of(caption)
            required_attr = el.get("required")
            fields.append(
                XfaField(
                    native_name=full_name(el),
                    visible_label=label,
                    ui_kind=_ui_kind(el),
                    bbox=bbox_of(el),
                    required_flag=required_attr in ("1", "true"),
                    options=options_of(el),
                )
            )
        elif local == "exclGroup":
            fields.append(
                XfaField(
                    native_name=full_name(el),
                    visible_label=None,
                    ui_kind="radio",
                    bbox=bbox_of(el),
                    required_flag=el.get("required") in ("1", "true"),
                    options=options_of(el),
                )
            )
    return fields


def extract_xfa_template_bytes(xfa_entry: Any) -> Optional[bytes]:
    """Pull the `template` stream out of an AcroForm /XFA entry.

    The /XFA entry is an array of (name, stream) pairs. Returns None when
    no template part exists (never raises: a malformed packet is a
    review trigger, not a crash).
    """
    if xfa_entry is None:
        return None
    try:
        parts = xfa_entry.get_object()
    except Exception:
        return None
    if not isinstance(parts, list) or len(parts) < 2:
        return None
    for i in range(0, len(parts) - 1, 2):
        try:
            name = str(parts[i])
            stream = parts[i + 1].get_object().get_data()
        except Exception:
            continue
        if name == "template":
            return stream
    return None
