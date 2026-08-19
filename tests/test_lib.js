const assert = require("assert");
// Load the same fuzzy-matching library the browser pulls from unpkg so the
// tests exercise the real `token_sort_ratio`, not lib.js's crude fallback.
// lib.js reads `fuzzball` as a global at call time, so expose it here.
try {
  global.fuzzball = require("fuzzball");
} catch {
  console.warn("⚠ fuzzball not installed — run `npm install`; tests fall back to the approximate matcher.");
}
const lib = require("../docs/lib.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── stripLatex ──");

test("removes LaTeX accents", () => {
  assert.strictEqual(lib.stripLatex("\\'a"), "á");
  assert.strictEqual(lib.stripLatex('\\"o'), "ö");
  assert.strictEqual(lib.stripLatex("\\~n"), "ñ");
});

test("removes LaTeX commands", () => {
  assert.strictEqual(lib.stripLatex("\\textbf{bold}"), "bold");
  assert.strictEqual(lib.stripLatex("\\emph{text}"), "text");
});

test("removes braces", () => {
  assert.strictEqual(lib.stripLatex("{Hello} {World}"), "Hello World");
});

test("returns empty for falsy input", () => {
  assert.strictEqual(lib.stripLatex(""), "");
  assert.strictEqual(lib.stripLatex(null), "");
  assert.strictEqual(lib.stripLatex(undefined), "");
});

test("handles combined LaTeX", () => {
  const input = "Ren\\'{e} {D}escartes";
  const result = lib.stripLatex(input);
  assert.ok(result.includes("Descartes"), `Expected Descartes in "${result}"`);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── normalizeTitle ──");

test("lowercases and strips LaTeX", () => {
  assert.strictEqual(lib.normalizeTitle("{Attention} Is All You Need"), "attention is all you need");
});

test("handles empty string", () => {
  assert.strictEqual(lib.normalizeTitle(""), "");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── parseBib ──");

test("parses a single article entry", () => {
  const bib = `@article{vaswani2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish},
  year = {2017},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].ENTRYTYPE, "article");
  assert.strictEqual(entries[0].ID, "vaswani2017");
  assert.strictEqual(entries[0].title, "Attention Is All You Need");
  assert.strictEqual(entries[0].author, "Vaswani, Ashish");
  assert.strictEqual(entries[0].year, "2017");
});

test("parses multiple entries", () => {
  const bib = `@article{a, title={Paper A}, year={2020}}
@inproceedings{b, title={Paper B}, year={2021}}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].ID, "a");
  assert.strictEqual(entries[1].ID, "b");
  assert.strictEqual(entries[1].ENTRYTYPE, "inproceedings");
});

test("skips @string and @comment entries", () => {
  const bib = `@string{foo = {bar}}

@comment{This is a comment, with commas}

@article{real, title={Real Entry}, year={2023}}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].ID, "real");
});

test("handles double-quoted field values", () => {
  const bib = `@article{test, title="Quoted Title", year={2023}}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries[0].title, "Quoted Title");
});

test("handles numeric field values", () => {
  const bib = `@article{test, title={Test}, year=2023}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries[0].year, "2023");
});

test("handles hyphenated field names", () => {
  const bib = `@article{test, mendeley-groups={Riblets}, title={Title}}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries[0]["mendeley-groups"], "Riblets");
  assert.strictEqual(entries[0].title, "Title");
});

test("returns empty array for invalid input", () => {
  assert.deepStrictEqual(lib.parseBib("not bibtex"), []);
  assert.deepStrictEqual(lib.parseBib(""), []);
});

test("parses misc with missing closing braces before next field (double-brace typos)", () => {
  const bib = `@misc{github_copilot_2025,
  author = {{GitHub},
  title = {{GitHub Copilot},
  howpublished = {\\url{https://github.com/features/copilot},
  year = {2025},
  note = {Accessed: 2025-06-01},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].author, "{GitHub}");
  assert.strictEqual(entries[0].title, "{GitHub Copilot}");
  assert.ok(entries[0].howpublished.includes("github.com/features/copilot"));
  assert.strictEqual(entries[0].year, "2025");
});

test("keeps fields after an '@' inside a value (email in note)", () => {
  const bib = `@article{k1,
  title = {A study of foo},
  note = {contact author at foo@bar.edu},
  year = {2020},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].note, "contact author at foo@bar.edu");
  assert.strictEqual(entries[0].year, "2020");
});

test("does not split one entry into two on an '@' in a value", () => {
  const bib = `@article{k1,
  title = {First},
  url = {https://example.com/@handle/post},
  year = {2020},
}
@article{k2,
  title = {Second},
  year = {2021},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].ID, "k1");
  assert.strictEqual(entries[0].url, "https://example.com/@handle/post");
  assert.strictEqual(entries[0].year, "2020");
  assert.strictEqual(entries[1].ID, "k2");
  assert.strictEqual(entries[1].year, "2021");
});

test("parses misc Cursor-style malformed braces", () => {
  const bib = `@misc{cursor_2025,
  author = {{Anysphere},
  title = {{Cursor: The AI Code Editor},
  howpublished = {\\url{https://www.cursor.com},
  year = {2025},
}`;
  const entries = lib.parseBib(bib);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].author, "{Anysphere}");
  assert.strictEqual(entries[0].title, "{Cursor: The AI Code Editor}");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── entriesToBib ──");

test("serializes entries back to BibTeX", () => {
  const entries = [{ ENTRYTYPE: "article", ID: "test2023", title: "My Paper", year: "2023" }];
  const bib = lib.entriesToBib(entries);
  assert.ok(bib.includes("@article{test2023,"));
  assert.ok(bib.includes("title           = {My Paper}"));
  assert.ok(bib.includes("year            = {2023}"));
});

test("skips internal fields starting with _", () => {
  const entries = [{ ENTRYTYPE: "article", ID: "x", title: "T", _source: "crossref" }];
  const bib = lib.entriesToBib(entries);
  assert.ok(!bib.includes("_source"));
});

test("round-trips parse → serialize", () => {
  const original = `@inproceedings{bert2019,
  title = {BERT: Pre-training of Deep Bidirectional Transformers},
  author = {Devlin, Jacob},
  year = {2019},
}`;
  const entries = lib.parseBib(original);
  const serialized = lib.entriesToBib(entries);
  const reparsed = lib.parseBib(serialized);
  assert.strictEqual(reparsed.length, 1);
  assert.strictEqual(reparsed[0].title, entries[0].title);
  assert.strictEqual(reparsed[0].author, entries[0].author);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── titleSimilarity ──");

test("identical titles score 100", () => {
  assert.strictEqual(lib.titleSimilarity("Attention Is All You Need", "Attention Is All You Need"), 100);
});

test("case-insensitive comparison", () => {
  assert.strictEqual(lib.titleSimilarity("attention is all you need", "ATTENTION IS ALL YOU NEED"), 100);
});

test("completely different titles score low", () => {
  const score = lib.titleSimilarity("Attention Is All You Need", "Quantum Chromodynamics at Finite Baryon Density");
  assert.ok(score < 75, `Expected < 75, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── normalizeText ──");

test("removes diacritics and lowercases", () => {
  assert.strictEqual(lib.normalizeText("René Descartes"), "rene descartes");
});

test("collapses whitespace", () => {
  assert.strictEqual(lib.normalizeText("  hello   world  "), "hello world");
});

test("returns empty for falsy input", () => {
  assert.strictEqual(lib.normalizeText(""), "");
  assert.strictEqual(lib.normalizeText(null), "");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── normalizeAuthorSet ──");

test("extracts last names from 'Last, First' format", () => {
  const names = lib.normalizeAuthorSet("Vaswani, Ashish and Shazeer, Noam");
  assert.ok(names.has("vaswani"));
  assert.ok(names.has("shazeer"));
  assert.strictEqual(names.size, 2);
});

test("extracts last names from 'First Last' format", () => {
  const names = lib.normalizeAuthorSet("Ashish Vaswani and Noam Shazeer");
  assert.ok(names.has("vaswani"));
  assert.ok(names.has("shazeer"));
});

test("returns empty set for empty input", () => {
  assert.strictEqual(lib.normalizeAuthorSet("").size, 0);
  assert.strictEqual(lib.normalizeAuthorSet(null).size, 0);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── normalizePages ──");

test("normalizes different dash styles", () => {
  assert.strictEqual(lib.normalizePages("1--10"), "1-10");
  assert.strictEqual(lib.normalizePages("1 - 10"), "1-10");
  assert.strictEqual(lib.normalizePages("1---10"), "1-10");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── compareAuthors ──");

test("identical authors score 100", () => {
  assert.strictEqual(lib.compareAuthors("Vaswani, Ashish", "Vaswani, Ashish"), 100);
});

test("same last names, different format still match", () => {
  const score = lib.compareAuthors("Vaswani, Ashish and Shazeer, Noam", "Ashish Vaswani and Noam Shazeer");
  assert.strictEqual(score, 100);
});

test("no overlap scores 0", () => {
  assert.strictEqual(lib.compareAuthors("Smith, John", "Doe, Jane"), 0);
});

test("both empty scores 100", () => {
  assert.strictEqual(lib.compareAuthors("", ""), 100);
});

test("one empty scores 0", () => {
  assert.strictEqual(lib.compareAuthors("Smith, John", ""), 0);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── compareField ──");

test("year comparison is exact", () => {
  assert.strictEqual(lib.compareField("year", "2023", "2023"), 100);
  assert.strictEqual(lib.compareField("year", "2023", "2024"), 0);
});

test("doi comparison is exact and case-insensitive", () => {
  assert.strictEqual(lib.compareField("doi", "10.1234/abc", "10.1234/ABC"), 100);
});

test("pages with different dashes match", () => {
  assert.strictEqual(lib.compareField("pages", "1--10", "1-10"), 100);
});

test("both empty returns 100", () => {
  assert.strictEqual(lib.compareField("journal", "", ""), 100);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── compareEntry ──");

test("verified when all fields match", () => {
  const orig = { title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017" };
  const found = { title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017" };
  const result = lib.compareEntry(orig, found);
  assert.strictEqual(result.status, "verified");
});

test("updated when fields differ", () => {
  const orig = { title: "Attention Is All You Need", year: "2017" };
  const found = { title: "Attention Is All You Need", year: "2018" };
  const result = lib.compareEntry(orig, found);
  assert.strictEqual(result.status, "updated");
  assert.ok(result.field_diffs.some(d => d.field === "year"));
});

test("needs_review when titles differ significantly", () => {
  const orig = { title: "Attention Is All You Need" };
  const found = { title: "On the Origin of Species" };
  const result = lib.compareEntry(orig, found);
  assert.strictEqual(result.status, "needs_review");
});

test("enrichments mark entry as updated", () => {
  const orig = { title: "Test Paper", year: "2023" };
  const found = { title: "Test Paper", year: "2023", doi: "10.1234/test" };
  const result = lib.compareEntry(orig, found);
  assert.strictEqual(result.status, "updated");
  assert.ok(result.field_diffs.some(d => d.field === "doi"), "should report doi enrichment");
});

test("does not suggest the older year when found is a preprint", () => {
  // User has the published venue year (2021); the arXiv record is from 2020.
  const orig = { title: "Great Paper", year: "2021", journal: "NeurIPS" };
  const found = { title: "Great Paper", year: "2020", journal: "arXiv" };
  const result = lib.compareEntry(orig, found);
  assert.ok(!result.field_diffs.some(d => d.field === "year"),
    "should not flag the preprint's earlier year");
});

test("still flags a genuine year mismatch for non-preprint records", () => {
  const orig = { title: "Great Paper", year: "2021", journal: "NeurIPS" };
  const found = { title: "Great Paper", year: "2019", journal: "NeurIPS" };
  const result = lib.compareEntry(orig, found);
  assert.ok(result.field_diffs.some(d => d.field === "year"),
    "non-preprint year mismatch should still be reported");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── fieldDiffsForNeedsReview ──");

test("returns empty array when found is null", () => {
  assert.deepStrictEqual(lib.fieldDiffsForNeedsReview({ title: "X" }, null), []);
});

test("includes title and differing fields for a weak title match", () => {
  const orig = {
    title: "My Completely Different Title",
    author: "Smith, Alice",
    year: "2020",
  };
  const found = {
    title: "Attention Is All You Need",
    author: "Vaswani, Ashish",
    year: "2017",
    journal: "NeurIPS",
  };
  const diffs = lib.fieldDiffsForNeedsReview(orig, found);
  assert.ok(diffs.some(d => d.field === "title"));
  assert.ok(diffs.some(d => d.field === "author"));
  assert.ok(diffs.some(d => d.field === "year"));
  assert.ok(diffs.some(d => d.field === "journal"));
});

test("includes enrichment fields from found", () => {
  const orig = { title: "Different Title Here", year: "2023" };
  const found = { title: "Another Title", year: "2023", doi: "10.1000/182" };
  const diffs = lib.fieldDiffsForNeedsReview(orig, found);
  assert.ok(diffs.some(d => d.field === "doi" && d.score === 0), "doi should be enrichment");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── crossrefToStandard ──");

test("converts CrossRef response to standard format", () => {
  const item = {
    title: ["Attention Is All You Need"],
    author: [{ family: "Vaswani", given: "Ashish" }],
    "published-print": { "date-parts": [[2017]] },
    "container-title": ["NeurIPS"],
    DOI: "10.5555/3295222.3295349",
    volume: "30",
    page: "5998-6008",
  };
  const result = lib.crossrefToStandard(item);
  assert.strictEqual(result.title, "Attention Is All You Need");
  assert.strictEqual(result.author, "Vaswani, Ashish");
  assert.strictEqual(result.year, "2017");
  assert.strictEqual(result.doi, "10.5555/3295222.3295349");
  assert.strictEqual(result._source, "crossref");
});

test("handles missing fields gracefully", () => {
  const result = lib.crossrefToStandard({});
  assert.strictEqual(result.title, "");
  assert.strictEqual(result.author, "");
  assert.strictEqual(result.year, "");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── ssToStandard ──");

test("converts Semantic Scholar response to standard format", () => {
  const paper = {
    title: "BERT",
    authors: [{ name: "Jacob Devlin" }, { name: "Ming-Wei Chang" }],
    year: 2019,
    venue: "NAACL",
    externalIds: { DOI: "10.18653/v1/N19-1423" },
  };
  const result = lib.ssToStandard(paper);
  assert.strictEqual(result.title, "BERT");
  assert.strictEqual(result.author, "Devlin, Jacob and Chang, Ming-Wei");
  assert.strictEqual(result.year, "2019");
  assert.strictEqual(result.journal, "NAACL");
  assert.strictEqual(result._source, "semantic_scholar");
});

test("prefers publicationVenue.name over venue string", () => {
  const paper = {
    title: "Test",
    authors: [],
    year: 2023,
    venue: "short",
    publicationVenue: { name: "Full Venue Name" },
    externalIds: {},
  };
  const result = lib.ssToStandard(paper);
  assert.strictEqual(result.journal, "Full Venue Name");
});

test("falls back to arXiv venue for preprint-only records", () => {
  const paper = {
    title: "A Preprint",
    year: 2020,
    authors: [{ name: "Alice Smith" }],
    externalIds: { ArXiv: "2001.00001" },
  };
  const result = lib.ssToStandard(paper);
  assert.strictEqual(result.journal, "arXiv");
  assert.strictEqual(lib.isPreprint(result), true);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── openAlexToStandard ──");

test("converts OpenAlex response to standard format", () => {
  const work = {
    title: "Attention Is All You Need",
    publication_year: 2017,
    doi: "https://doi.org/10.5555/3295222.3295349",
    authorships: [
      { author: { display_name: "Ashish Vaswani" } },
      { author: { display_name: "Noam Shazeer" } },
    ],
    primary_location: { source: { display_name: "NeurIPS", host_organization_name: "MIT Press" } },
    biblio: { volume: "30", issue: "1", first_page: "5998", last_page: "6008" },
  };
  const result = lib.openAlexToStandard(work);
  assert.strictEqual(result.title, "Attention Is All You Need");
  assert.strictEqual(result.author, "Vaswani, Ashish and Shazeer, Noam");
  assert.strictEqual(result.year, "2017");
  assert.strictEqual(result.journal, "NeurIPS");
  assert.strictEqual(result.volume, "30");
  assert.strictEqual(result.number, "1");
  assert.strictEqual(result.pages, "5998-6008");
  assert.strictEqual(result.doi, "10.5555/3295222.3295349", "DOI URL prefix should be stripped");
  assert.strictEqual(result.publisher, "MIT Press");
  assert.strictEqual(result._source, "openalex");
});

test("falls back to display_name and handles missing fields", () => {
  const result = lib.openAlexToStandard({ display_name: "A Title", id: "https://openalex.org/W1" });
  assert.strictEqual(result.title, "A Title");
  assert.strictEqual(result.author, "");
  assert.strictEqual(result.year, "");
  assert.strictEqual(result.doi, "");
  assert.strictEqual(result.url, "https://openalex.org/W1");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── extractLastNames ──");

test("extracts from 'Last, First and Last, First' format", () => {
  const names = lib.extractLastNames("Vaswani, Ashish and Shazeer, Noam");
  assert.ok(names.has("vaswani"));
  assert.ok(names.has("shazeer"));
});

test("extracts from 'First Last' format", () => {
  const names = lib.extractLastNames("Ashish Vaswani");
  assert.ok(names.has("vaswani"));
});

test("returns empty set for empty input", () => {
  assert.strictEqual(lib.extractLastNames("").size, 0);
  assert.strictEqual(lib.extractLastNames(null).size, 0);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── isSamePaper ──");

test("same paper returns true", () => {
  const a = { title: "Attention Is All You Need", year: "2017", author: "Vaswani, Ashish" };
  const b = { title: "Attention Is All You Need", year: "2017", author: "Vaswani, Ashish" };
  assert.strictEqual(lib.isSamePaper(a, b), true);
});

test("different titles returns false", () => {
  const a = { title: "Paper A" };
  const b = { title: "Completely Different Paper" };
  assert.strictEqual(lib.isSamePaper(a, b), false);
});

test("different years returns false", () => {
  const a = { title: "Attention Is All You Need", year: "2017" };
  const b = { title: "Attention Is All You Need", year: "2020" };
  assert.strictEqual(lib.isSamePaper(a, b), false);
});

test("treats preprint and published years within tolerance as the same paper", () => {
  const preprint = { title: "Attention Is All You Need", year: "2016", author: "Vaswani, Ashish" };
  const published = { title: "Attention Is All You Need", year: "2017", author: "Vaswani, Ashish" };
  assert.strictEqual(lib.isSamePaper(preprint, published), true);
});

// ════════════════════════════════════════════════════════════════
console.log("\n── isPreprint ──");

test("detects arXiv by venue, DOI, and URL", () => {
  assert.strictEqual(lib.isPreprint({ journal: "arXiv" }), true);
  assert.strictEqual(lib.isPreprint({ journal: "arXiv.org" }), true);
  assert.strictEqual(lib.isPreprint({ doi: "10.48550/arXiv.1706.03762" }), true);
  assert.strictEqual(lib.isPreprint({ url: "https://arxiv.org/abs/1706.03762" }), true);
  assert.strictEqual(lib.isPreprint({ journal: "CoRR" }), true);
});

test("does not flag published venues as preprints", () => {
  assert.strictEqual(lib.isPreprint({ journal: "NeurIPS", doi: "10.5555/x" }), false);
  assert.strictEqual(lib.isPreprint({}), false);
  assert.strictEqual(lib.isPreprint(null), false);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── mergeMetadata ──");

test("primary fields take precedence", () => {
  const primary = { title: "A", year: "2020", _source: "ss" };
  const secondary = { title: "B", year: "2021", doi: "10.1234", _source: "cr" };
  const merged = lib.mergeMetadata(primary, secondary);
  assert.strictEqual(merged.title, "A");
  assert.strictEqual(merged.year, "2020");
  assert.strictEqual(merged.doi, "10.1234");
  assert.strictEqual(merged._source, "ss+cr");
});

test("fills empty fields from secondary", () => {
  const primary = { title: "A", _source: "ss" };
  const secondary = { doi: "10.1234", volume: "5", _source: "cr" };
  const merged = lib.mergeMetadata(primary, secondary);
  assert.strictEqual(merged.doi, "10.1234");
  assert.strictEqual(merged.volume, "5");
});

test("published record wins bibliographic fields over a preprint primary", () => {
  const preprint = { title: "A", year: "2020", journal: "arXiv", _source: "semantic_scholar" };
  const published = { title: "A", year: "2021", journal: "NeurIPS", doi: "10.1/x", _source: "crossref" };
  const merged = lib.mergeMetadata(preprint, published);
  assert.strictEqual(merged.year, "2021", "published year should win");
  assert.strictEqual(merged.journal, "NeurIPS", "published venue should win");
  assert.strictEqual(merged.doi, "10.1/x");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── bestMatch ──");

test("returns best matching candidate above threshold", () => {
  const candidates = [
    { title: "Completely Wrong" },
    { title: "Attention Is All You Need" },
  ];
  const result = lib.bestMatch(candidates, "Attention Is All You Need");
  assert.strictEqual(result.title, "Attention Is All You Need");
});

test("returns null when no candidate meets threshold", () => {
  const candidates = [{ title: "Quantum Chromodynamics at Finite Baryon Density" }];
  const result = lib.bestMatch(candidates, "Attention Is All You Need");
  assert.strictEqual(result, null);
});

test("returns null for empty candidates", () => {
  assert.strictEqual(lib.bestMatch([], "test"), null);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── cleanVenue ──");

test("strips leading 'The ' or 'the ' case-insensitively", () => {
  assert.strictEqual(lib.cleanVenue("The Physics of Fluids"), "Physics of Fluids");
  assert.strictEqual(lib.cleanVenue("the Journal of Fluid Mechanics"), "Journal of Fluid Mechanics");
  assert.strictEqual(lib.cleanVenue("Physics of Fluids"), "Physics of Fluids");
  assert.strictEqual(lib.cleanVenue(""), "");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── abbreviateVenue ──");

test("abbreviates known venues", () => {
  assert.strictEqual(lib.abbreviateVenue("Advances in Neural Information Processing Systems"), "NeurIPS");
  assert.strictEqual(lib.abbreviateVenue("International Conference on Machine Learning"), "ICML");
  assert.strictEqual(lib.abbreviateVenue("Physics of Fluids"), "Phys. Fluids");
  assert.strictEqual(lib.abbreviateVenue("Journal of Fluid Mechanics"), "J. Fluid Mech.");
});

test("returns original for unknown venues", () => {
  assert.strictEqual(lib.abbreviateVenue("Some Unknown Workshop"), "Some Unknown Workshop");
});

test("handles null/empty gracefully", () => {
  assert.strictEqual(lib.abbreviateVenue(""), "");
  assert.strictEqual(lib.abbreviateVenue(null), null);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── expandVenue ──");

test("expands known abbreviations", () => {
  assert.strictEqual(lib.expandVenue("NeurIPS"), "Advances in Neural Information Processing Systems");
  assert.strictEqual(lib.expandVenue("Phys. Fluids"), "Physics of Fluids");
  assert.strictEqual(lib.expandVenue("J. Fluid Mech."), "Journal of Fluid Mechanics");
});

test("returns original for unknown abbreviations", () => {
  assert.strictEqual(lib.expandVenue("XYZCONF"), "XYZCONF");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── Constants ──");

test("TITLE_MATCH_THRESHOLD is reasonable", () => {
  assert.ok(lib.TITLE_MATCH_THRESHOLD >= 70 && lib.TITLE_MATCH_THRESHOLD <= 100);
});

test("MIN_TITLE_SIM is reasonable", () => {
  assert.ok(lib.MIN_TITLE_SIM >= 50 && lib.MIN_TITLE_SIM <= 90);
});

test("COMPARED_FIELDS contains expected fields", () => {
  assert.ok(lib.COMPARED_FIELDS.includes("author"));
  assert.ok(lib.COMPARED_FIELDS.includes("year"));
  assert.ok(lib.COMPARED_FIELDS.includes("doi"));
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── cleanNote ──");

test("returns empty for falsy input", () => {
  assert.strictEqual(lib.cleanNote(""), "");
  assert.strictEqual(lib.cleanNote(null), "");
  assert.strictEqual(lib.cleanNote(undefined), "");
});

test("keeps a note the user actually wrote", () => {
  const note = "Cited in the related work section.";
  assert.strictEqual(lib.cleanNote(note), note);
});

test("strips Zotero read-status bookkeeping", () => {
  const note = "Read\\_Status: Read\nRead\\_Status\\_Date: 2023-06-27T01:46:48.348Z";
  assert.strictEqual(lib.cleanNote(note), "");
});

test("strips bookkeeping after the parser collapsed newlines to spaces", () => {
  const note = "Read\\_Status: Read Read\\_Status\\_Date: 2023-06-27T01:46:48.348Z";
  assert.strictEqual(lib.cleanNote(note), "");
});

test("keeps prose and drops the bookkeeping around it", () => {
  const note = "Read\\_Status: Read\nGreat SymCC paper.\nZSCC: 0000123";
  assert.strictEqual(lib.cleanNote(note), "Great SymCC paper.");
});

test("is case-insensitive and tolerates unescaped underscores", () => {
  assert.strictEqual(lib.cleanNote("read_status: read"), "");
});

test("leaves unknown key-value notes alone", () => {
  const note = "PMID: 12345678";
  assert.strictEqual(lib.cleanNote(note), note);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── cleanEntryNotes ──");

test("drops a note that was pure bookkeeping", () => {
  const entry = { ID: "poeplau2020", title: "SymCC", note: "Read\\_Status: Read" };
  const out = lib.cleanEntryNotes(entry);
  assert.ok(!("note" in out));
  assert.strictEqual(out.title, "SymCC");
});

test("cleans annote too and does not mutate the input", () => {
  const entry = { ID: "x", annote: "ZSCC: 0000123\nWorth re-reading." };
  const out = lib.cleanEntryNotes(entry);
  assert.strictEqual(out.annote, "Worth re-reading.");
  assert.strictEqual(entry.annote, "ZSCC: 0000123\nWorth re-reading.");
});

test("leaves entries without notes untouched", () => {
  const entry = { ID: "x", title: "Foo" };
  assert.deepStrictEqual(lib.cleanEntryNotes(entry), entry);
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── entryMatchesQuery ──");

test("empty / whitespace query matches everything", () => {
  const e = { title: "Foo", ID: "bar" };
  assert.strictEqual(lib.entryMatchesQuery(e, ""), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "   "), true);
  assert.strictEqual(lib.entryMatchesQuery(e, null), true);
});

test("case-insensitive substring match on title and key", () => {
  const e = { title: "Attention Is All You Need", ID: "vaswani2017attention" };
  assert.strictEqual(lib.entryMatchesQuery(e, "attention"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "VASWANI"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "transformer"), false);
});

test("AND-of-tokens: every token must match somewhere", () => {
  const e = { title: "Attention Is All You Need", ID: "vaswani2017attention" };
  assert.strictEqual(lib.entryMatchesQuery(e, "attention vaswani"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "attention nope"), false);
});

test("field-qualified tokens scope the match", () => {
  const e = { title: "Compositional Generation", ID: "liu2022work" };
  assert.strictEqual(lib.entryMatchesQuery(e, "title:compositional"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "title:liu"), false);
  assert.strictEqual(lib.entryMatchesQuery(e, "id:liu2022"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "key:liu2022"), true);
  assert.strictEqual(lib.entryMatchesQuery(e, "id:compositional"), false);
});

test("uses entry_id (result shape) when ID is absent", () => {
  const r = { title: "Foo", entry_id: "smith2020foo" };
  assert.strictEqual(lib.entryMatchesQuery(r, "smith"), true);
});

test("strips LaTeX from title before matching", () => {
  const e = { title: "{Caf\\'e} Studies", ID: "x" };
  assert.strictEqual(lib.entryMatchesQuery(e, "café"), true);
});

// ─── getAuthorCompleteness & isMoreComplete ──
console.log("\n── getAuthorCompleteness & isMoreComplete ──");

test("calculates author completeness correctly", () => {
  const c1 = lib.getAuthorCompleteness("Robinson, F. A.");
  assert.strictEqual(c1.initials, 2);
  assert.strictEqual(c1.full, 1);

  const c2 = lib.getAuthorCompleteness("Robinson, Frank A.");
  assert.strictEqual(c2.initials, 1);
  assert.strictEqual(c2.full, 2);

  assert.strictEqual(lib.isMoreComplete("Robinson, F. A.", "Robinson, Frank A."), true);
  assert.strictEqual(lib.isMoreComplete("Robinson, Frank A.", "Robinson, F. A."), false);
  assert.strictEqual(lib.isMoreComplete("Robinson, F. A.", "Robinson, F. A."), false);
});

// ─── getAiaaPaperNumber ──
console.log("\n── getAiaaPaperNumber ──");

test("extracts AIAA paper number from DOI, journal, booktitle, howpublished, or year", () => {
  assert.strictEqual(lib.getAiaaPaperNumber({ doi: "10.2514/6.1988-2526" }), "88-2526");
  assert.strictEqual(lib.getAiaaPaperNumber({ doi: "10.2514/6.2019-1627" }), "2019-1627");
  assert.strictEqual(lib.getAiaaPaperNumber({ journal: "AIAA Paper 2016-0048" }), "2016-0048");
  assert.strictEqual(lib.getAiaaPaperNumber({ year: "AIAA Paper 84-0347, 1984" }), "84-0347");
  assert.strictEqual(lib.getAiaaPaperNumber({ booktitle: "AIAA Scitech 2019 Forum", pages: "1627", year: "2019" }), "2019-1627");
});

// ─── AIAA Paper Formatting in compareEntry ──
console.log("\n── AIAA Paper Formatting in compareEntry ──");

test("converts AIAA conference papers to @misc and sets howpublished", () => {
  const original = {
    ENTRYTYPE: "inproceedings",
    title: "Effects of Riblets On Turbulence in a Supersonic Boundary Layer",
    author: "Robinson, F.A",
    year: "1988",
    booktitle: "AIAA Conference",
  };
  const found = {
    ENTRYTYPE: "inproceedings",
    title: "Effects of Riblets On Turbulence in a Supersonic Boundary Layer",
    author: "Robinson, F.A",
    year: "1988",
    doi: "10.2514/6.1988-2526",
    journal: "AIAA Paper 88-2526",
  };

  const res = lib.compareEntry(original, found);
  assert.strictEqual(res.status, "updated");
  assert.strictEqual(res.suggested.ENTRYTYPE, "misc");
  assert.strictEqual(res.suggested.howpublished, "AIAA Paper 88-2526");
  // booktitle in original should be suggested to remove
  assert.strictEqual(res.suggested.booktitle, null);
});

// ─── titleCaseIfAllCaps & Field Ordering ──
console.log("\n── titleCaseIfAllCaps & Field Ordering ──");

test("cleans up ALL CAPS authors to mixed case", () => {
  const c1 = lib.titleCaseIfAllCaps("DUAN, L.");
  assert.strictEqual(c1, "Duan, L.");

  const c2 = lib.titleCaseIfAllCaps("DUAN, L. and BEEKMAN, I. and MARTÍN, M. P.");
  assert.strictEqual(c2, "Duan, L. and Beekman, I. and Martín, M. P.");

  // Mixed case should be left alone
  const c3 = lib.titleCaseIfAllCaps("L. Duan and Izaak Beekman");
  assert.strictEqual(c3, "L. Duan and Izaak Beekman");
});

test("orders fields logically in entriesToBib", () => {
  const entry = {
    ENTRYTYPE: "article",
    ID: "test",
    doi: "10.123",
    author: "Some Author",
    title: "Some Title",
    year: "2020",
    volume: "10",
  };
  const bib = lib.entriesToBib([entry]);
  const expectedLines = [
    "@article{test,",
    "    title           = {Some Title},",
    "    author          = {Some Author},",
    "    year            = {2020},",
    "    volume          = {10},",
    "    doi             = {10.123},",
    "}"
  ];
  for (const line of expectedLines) {
    assert.ok(bib.includes(line), `BibTeX output should contain: ${line}`);
  }
  const titleIdx = bib.indexOf("title           = {Some Title}");
  const authorIdx = bib.indexOf("author          = {Some Author}");
  const yearIdx = bib.indexOf("year            = {2020}");
  const volumeIdx = bib.indexOf("volume          = {10}");
  const doiIdx = bib.indexOf("doi             = {10.123}");

  assert.ok(titleIdx < authorIdx, "title should come before author");
  assert.ok(authorIdx < yearIdx, "author should come before year");
  assert.ok(yearIdx < volumeIdx, "year should come before volume");
  assert.ok(volumeIdx < doiIdx, "volume should come before doi");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n── generateCitationKey ──");

test("generates citation key according to requirements", () => {
  const entry1 = {
    author: "Roy, A. and Smith, J.",
    year: "2025",
    title: "Direct Numerical Simulation of Riblets",
  };
  assert.strictEqual(lib.generateCitationKey(entry1), "roy2025direct");

  const entry2 = {
    author: "Lian Duan and Pierre Ricco",
    year: "2016",
    title: "Pressure fluctuations in a supersonic boundary layer",
  };
  assert.strictEqual(lib.generateCitationKey(entry2), "duan2016pressure");

  const entry3 = {
    author: "Zuniga",
    year: "1992",
    title: "On NASA technical memorandum",
  };
  assert.strictEqual(lib.generateCitationKey(entry3), "zuniga1992nasa");

  const entry4 = {
    author: "No Author",
    year: "2020",
    title: "The and of a", // all stop words
  };
  assert.strictEqual(lib.generateCitationKey(entry4), "author2020the");
});

// ═══════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
