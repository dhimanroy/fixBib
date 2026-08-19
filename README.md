<div align="center">

# fixBib

**Clean, verify, and format your BibTeX references for aerospace and fluid dynamics publications.**

[![Live app](https://img.shields.io/badge/Try_it_live-dhimanroy.github.io-4f46e5?style=for-the-badge)](https://dhimanroy.github.io/fixBib/)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

---

## Acknowledgement

This project is based on the original [BibTeX Verifier](https://github.com/merfanian/Bibtex-Verifier) by `merfanian`.

---

### What it does


<p align="center">
  <sub><strong>Aerospace Standards</strong> · journal abbreviations · citation keys · field-level corrections · aligned formatting</sub>
</p>

<br/>

</div>

Runs **100% in your browser** — no install, no server, no account. Only paper titles are sent to public APIs ([Semantic Scholar](https://www.semanticscholar.org/), [CrossRef](https://www.crossref.org/), and [OpenAlex](https://openalex.org/) as a fallback); your `.bib` never leaves your machine.

---

## Why use this?

| Pain | What fixBib does |
|------|------------------|
| AIAA paper format is messy | Automatically standardizes to `@misc` with paper numbers |
| "J. Fluid Mech." vs "Journal of Fluid Mechanics" | Fast toggle between full and abbreviated journal names |
| Inconsistent citation keys | Standardizes keys dynamically (e.g. `roy2025direct`) |
| Unaligned & unreadable `.bib` files | Aligns field operators (`=`) and standardizes field ordering |

---

## Features

- **Aerospace Formatting**: Converts AIAA conference papers to standard `@misc` format and recommends removing redundant fields (volume, pages, journal, etc.) to match AIAA/JFM styles.
- **Journal Abbreviation**: Easily toggle between abbreviated names (e.g., *J. Fluid Mech.*, *Phys. Fluids*) and full titles for fluid mechanics and aerospace journals.
- **Citation Key Generator**: Generates clean citation keys formatted as `[first author's last name][year][significant title word]` (e.g., `roy2025direct`, `duan2016pressure`).
- **Clean & Beautify**: Aligns field operators, strips junk tags, fixes casing, and groups fields logically in a standardized sequence.
- **Multi-source Verification**: Semantic Scholar and CrossRef lookups with OpenAlex fallback for robust metadata retrieval.
- **Privacy-first**: All lookups are processed in-browser. Your bibliography never leaves your machine.

---

## How it works

```
Upload or paste .bib → Parse entries → For each entry:
    Semantic Scholar match → CrossRef enrich → OpenAlex fallback
→ Compare fields → Verified / Auto-updated / Needs review / Not found
→ You edit choices & select styling toggles → Export corrected .bib
```

**Statuses:** **Verified** (matches online record) · **Auto-updated** (same paper, metadata differs) · **Needs review** (weak title match — possible typo) · **Not found** (no index hit).


## Limitations

- **API rate limits** — large files take a few minutes; the app throttles politely.
- **Not everything is indexed** — some workshops, theses, or brand-new papers won’t appear.
- **Metadata isn’t perfect** — you always get the final say in the diff UI.

---


## License

[MIT](LICENSE)
