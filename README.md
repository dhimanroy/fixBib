<div align="center">

# fixBib

**Clean, verify, and format your BibTeX references according to prescribed publication styles.**

[![Live app](https://img.shields.io/badge/Try_it_live-dhimanroy.github.io-4f46e5?style=for-the-badge)](https://dhimanroy.github.io/fixBib/)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

---

## Acknowledgement

This project is based on the original [BibTeX Verifier](https://github.com/merfanian/Bibtex-Verifier) by `merfanian`.

---

### What it does

<p align="center">
  <sub><strong>Prescribed Publication Formats</strong> (AIAA, JFM, PoF) &middot; DOI-first verification &middot; full author name preservation &middot; journal abbreviations &middot; citation keys &middot; field alignment</sub>
</p>

<br/>

</div>

Runs **100% in your browser** — no install, no server, no account required. Queries public APIs ([CrossRef](https://www.crossref.org/), [Semantic Scholar](https://www.semanticscholar.org/), and [OpenAlex](https://openalex.org/)); your `.bib` file never leaves your machine.

---

## Why use this?

| Common BibTeX Issues | What fixBib does |
|----------------------|------------------|
| Target journal requires specific title casing & journal formatting | Select prescribed formats (**AIAA Journal**, **JFM or PoF**, or **As Input**) to format titles (Title Case vs Sentence Case), journal names, and AIAA conference papers instantly |
| Missing DOIs & incomplete fields | Performs DOI-first verification and exhaustively queries online databases to complete missing DOIs, dates, volumes, and page numbers |
| Downgraded author names | Preserves full author names (e.g., *Huang, Junji*) and prevents APIs from replacing them with initials |
| AIAA paper formatting varies | Formats AIAA conference papers as `@misc` with `howpublished` for AIAA Journal, or `@inproceedings` with `note` for JFM/PoF |
| Inconsistent citation keys & unaligned files | Generates standardized citation keys (e.g. `roy2026direct`) and exports aligned, clean BibTeX |

---

## Publication Formats Supported

- **As Input**: Cleans journal names and verifies metadata while preserving original title casing.
- **AIAA Journal**:
  - Publication Title: **Title Case** (e.g., *Simulation and Modeling of Cold-Wall Hypersonic...*)
  - Journal Name: **Full Name** (e.g., *Journal of Fluid Mechanics*)
  - AIAA Conference Papers: Formatted as `@misc` with `howpublished = {AIAA Paper 2026-2139}`.
- **JFM or PoF**:
  - Publication Title: **Sentence Case** (e.g., *Simulation and modeling of cold-wall hypersonic...*)
  - Journal Name: **Abbreviated ISO standard** (e.g., *J. Fluid Mech.*, *Phys. Fluids*, *J. Comput. Phys.*, *Phil. Trans. R. Soc. A*)
  - AIAA Conference Papers: Kept as `@inproceedings` with `note = {AIAA Paper 2026-2139}` and `booktitle`.

---

## Key Features

- **Prescribed Publication Formatting**: One-click formatting for AIAA Journal, JFM, PoF, and custom entry preferences.
- **DOI-First & Multi-Source Verification**: Queries CrossRef, Semantic Scholar, and OpenAlex directly by DOI or title to ensure high-accuracy reference verification.
- **Author Full Name Protection**: Automatically prevents APIs from downgrading full author names to initials.
- **Comprehensive Science & Engineering Abbreviations**: Built-in dictionary supporting standard ISO 4 journal abbreviations across aerospace, fluid dynamics, thermal sciences, physics, chemistry, and computer science.
- **Citation Key Generator**: Standardized keys formatted as `[author][year][title word]` (e.g. `roy2026direct`).
- **Privacy-first**: Processing happens entirely in-browser.

---

## How it works

```
Upload or paste .bib → Parse entries → For each entry:
    DOI direct lookup → CrossRef / Semantic Scholar / OpenAlex fallback
→ Apply Publication Format (AIAA / JFM or PoF / As Input)
→ Verify & Compare fields → Verified / Auto-updated / Needs review / Not found
→ Export standardized, aligned .bib file
```

---

## License

[MIT](LICENSE)
