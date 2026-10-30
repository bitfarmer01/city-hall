"""Smoke tests for the pinned extraction toolchain (build spec D1).

These prove the locked dependency graph installs and imports on the
interpreter CI pins (3.11) before any extraction code lands (D2/D3).
"""


def test_pypdf_imports_with_version():
    import pypdf

    assert pypdf.__version__


def test_pdfplumber_imports_with_version():
    import pdfplumber

    assert pdfplumber.__version__
