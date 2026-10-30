"""CLI end-to-end: catalog JSON emitted for the TypeScript side."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from conftest import fixture_pdf

PYTHON_DIR = Path(__file__).parents[1]
SCHEMA_VERSION = "d3a.1"


def _run_cli(
    pdf_path: Path, extra_args: list[str], agency: str = "dohmh"
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(PYTHON_DIR)
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "pdf_extraction",
            str(pdf_path),
            "--source-url",
            "https://www.nyc.gov/assets/doh/downloads/pdf/vr/birth1.pdf",
            "--agency",
            agency,
            "--captured-at",
            "2026-10-30T17:11:00Z",
            *extra_args,
        ],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(PYTHON_DIR),
    )


def test_cli_emits_catalog_json():
    result = _run_cli(fixture_pdf("birth1.pdf"), [])
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)

    assert payload["schemaVersion"] == SCHEMA_VERSION
    assert set(payload.keys()) == {
        "schemaVersion",
        "generatedAt",
        "form",
        "fields",
        "snapshot",
    }

    form = payload["form"]
    assert form["id"] == "form:dohmh:unnumbered-be955853"
    assert form["agency"] == "dohmh"
    assert form["fillableClass"] == "acroform"
    assert form["sourceUrl"] == (
        "https://www.nyc.gov/assets/doh/downloads/pdf/vr/birth1.pdf"
    )

    snapshot = payload["snapshot"]
    assert snapshot["method"] == "http_fetch"
    assert snapshot["id"] == form["snapshotId"]
    assert snapshot["sha256"].startswith("be95585389a7")

    fields = payload["fields"]
    assert len(fields) == 34
    first = fields[0]
    for key in (
        "id",
        "formId",
        "nativeName",
        "visibleLabel",
        "fieldType",
        "requiredStatus",
        "requirementLevel",
        "provenance",
    ):
        assert key in first, key
    assert first["provenance"]["sourceLayer"] == "acroform"


def test_cli_form_number_and_out_file(tmp_path: Path):
    out_path = tmp_path / "catalog" / "pw1.json"
    result = _run_cli(
        fixture_pdf("pw1.pdf"),
        [
            "--form-number",
            "PW1",
            "--out",
            str(out_path),
        ],
        agency="buildings",
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    assert payload["form"]["id"] == "form:buildings:pw1"
    assert payload["form"]["formNumber"] == "PW1"
    assert payload["form"]["fillableClass"] == "hybrid"
    assert len(payload["fields"]) >= 500


def test_cli_fails_loudly_on_garbage(tmp_path: Path):
    garbage = tmp_path / "not-a-pdf.pdf"
    garbage.write_bytes(b"definitely not a pdf")
    result = _run_cli(garbage, [])
    assert result.returncode == 1
    assert "extraction failed" in result.stderr
