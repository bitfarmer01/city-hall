# Fixture PDFs — D3a

Official NYC form PDFs, fetched from their public nyc.gov URLs on
2026-10-30 (HTTP 200, plain public fetch, no authentication). These are
the verified fixture forms named in build-spec D3 and the data-model
research (art_mcM1Ssao). SHA-256 pins the exact revision under test.

| File | Form | Agency | Source URL | SHA-256 (first 12) |
| --- | --- | --- | --- | --- |
| `pw1.pdf` | PW1 Plan/Work Application | DOB | https://www.nyc.gov/assets/buildings/pdf/pw1.pdf | `a68fd0c754fe` |
| `birth1.pdf` | Application to Request an NYC Birth Certificate | DOHMH | https://www.nyc.gov/assets/doh/downloads/pdf/vr/birth1.pdf | `be95585389a7` |
| `premium-birth.pdf` | Premium Mail Service Birth Certificate Application | DOHMH | https://www.nyc.gov/assets/doh/downloads/pdf/vr/premium-birth-certificate-app.pdf | `e515d15e176e` |
| `dog-license.pdf` | How to Apply for a Dog License (incl. mail application) | DOHMH | https://www.nyc.gov/assets/doh/downloads/pdf/vet/vet-doglicense-form.pdf | `77c432585a0c` |

Fillable-class coverage: `hybrid` (PW1: XFA + AcroForm shell), `acroform`
(both birth-certificate forms), `flattened` (dog license: text layer, no
live fields). The `scanned` class has no fixture here; it is covered by
unit tests of the pure classifier (`test_classify.py`).
