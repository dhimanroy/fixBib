/*
 * BibLib — pure logic functions for BibTeX Verifier.
 * Works as a browser global (window.BibLib) and as a Node.js module.
 */
(function (exports) {
  "use strict";

  // ─── Configuration ───────────────────────────────────────────────────
  const TITLE_MATCH_THRESHOLD = 85;
  const MIN_TITLE_SIM = 70;
  const COMPARED_FIELDS = [
    "ENTRYTYPE", "author", "year", "journal", "booktitle",
    "volume", "number", "pages", "doi", "publisher", "howpublished",
  ];

  // ─── LaTeX helpers ───────────────────────────────────────────────────
  const LATEX_ACCENT_MAP = {
    "\\'a":"á", "\\'e":"é", "\\'i":"í", "\\'o":"ó", "\\'u":"ú",
    "\\`a":"à", "\\`e":"è", "\\`i":"ì", "\\`o":"ò", "\\`u":"ù",
    '\\"a':"ä", '\\"e':"ë", '\\"i':"ï", '\\"o':"ö", '\\"u':"ü",
    "\\~n":"ñ", "\\~a":"ã", "\\~o":"õ",
    "\\^a":"â", "\\^e":"ê", "\\^i":"î", "\\^o":"ô", "\\^u":"û",
    "\\c{c}":"ç", "\\c c":"ç", "{\\ss}":"ß",
  };

  function stripLatex(text) {
    if (!text) return "";
    for (const [latex, ch] of Object.entries(LATEX_ACCENT_MAP))
      text = text.replaceAll(latex, ch);
    text = text.replace(/\\[a-zA-Z]+\s*/g, "");
    text = text.replace(/[{}]/g, "");
    return text.replace(/\s+/g, " ").trim();
  }

  function normalizeTitle(title) {
    return stripLatex(title).toLowerCase().trim();
  }

  // ─── BibTeX parser / serializer ──────────────────────────────────────
  function skipWhitespace(str, i) {
    while (i < str.length && /\s/.test(str[i])) i++;
    return i;
  }

  /** Append missing `}` so nested `{...}` recover from typos like `{{Foo},` before next field. */
  function balanceClosingBraces(s) {
    let net = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "{") net++;
      else if (s[i] === "}") net--;
    }
    let out = s;
    while (net > 0) {
      out += "}";
      net--;
    }
    return out;
  }

  /**
   * Parse `{...}` with nested-brace awareness. If the user omits the closing `}` before `,`
   * and the next token looks like another field (`title =`), treat the comma as the field
   * separator and repair inner braces (common with `{{GitHub},` typos).
   */
  function extractBracedFieldValue(str, start) {
    if (str[start] !== "{") return { value: "", next: start };
    let i = start + 1;
    let depth = 1;
    while (i < str.length && depth > 0) {
      const c = str[i];
      if (c === "{") {
        depth++;
        i++;
      } else if (c === "}") {
        depth--;
        i++;
        if (depth === 0) {
          const inner = str.slice(start + 1, i - 1);
          let next = skipWhitespace(str, i);
          if (str[next] === ",") next = skipWhitespace(str, next + 1);
          return { value: inner, next };
        }
      } else if (depth === 1 && c === ",") {
        const tail = str.slice(i + 1);
        if (/^\s*(?:\r?\n\s*)?\w+\s*=/.test(tail)) {
          const inner = str.slice(start + 1, i);
          return {
            value: balanceClosingBraces(inner),
            next: skipWhitespace(str, i + 1),
          };
        }
        i++;
      } else {
        i++;
      }
    }
    const inner = str.slice(start + 1);
    return { value: balanceClosingBraces(inner), next: str.length };
  }

  function extractQuotedFieldValue(str, start) {
    if (str[start] !== '"') return { value: "", next: start };
    let i = start + 1;
    let buf = "";
    while (i < str.length) {
      const c = str[i];
      if (c === "\\" && i + 1 < str.length) {
        buf += str[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        let next = skipWhitespace(str, i);
        if (str[next] === ",") next = skipWhitespace(str, next + 1);
        return { value: buf, next };
      }
      buf += c;
      i++;
    }
    return { value: buf, next: str.length };
  }

  function extractNumberFieldValue(str, start) {
    const m = /^(\d+)/.exec(str.slice(start));
    if (!m) return { value: "", next: start };
    let next = start + m[1].length;
    next = skipWhitespace(str, next);
    if (str[next] === ",") next = skipWhitespace(str, next + 1);
    return { value: m[1], next };
  }

  function parseEntryFields(body) {
    const fields = {};
    let i = skipWhitespace(body, 0);
    while (i < body.length) {
      const nameMatch = /^([\w-]+)\s*=\s*/.exec(body.slice(i));
      if (!nameMatch) break;
      const key = nameMatch[1].toLowerCase();
      i += nameMatch[0].length;
      i = skipWhitespace(body, i);
      if (i >= body.length) break;

      let ext;
      if (body[i] === "{") ext = extractBracedFieldValue(body, i);
      else if (body[i] === '"') ext = extractQuotedFieldValue(body, i);
      else if (/\d/.test(body[i])) ext = extractNumberFieldValue(body, i);
      else break;

      fields[key] = ext.value.replace(/\s*\n\s*/g, " ").trim();
      i = ext.next;
      i = skipWhitespace(body, i);
    }
    return fields;
  }

  function parseBib(content) {
    const entries = [];
    // An entry header is `@type{key,`. An entry body runs from just after that
    // header to the start of the next header (or end of input). We must NOT end
    // the body at the first `@` — field values legitimately contain `@`
    // (emails in `note`, URLs, etc.), and stopping there silently drops every
    // field after it. Collect all header positions first, then slice bodies
    // between them.
    const headerRe = /@(\w+)\s*\{([^,]*),/g;
    const headers = [];
    let m;
    while ((m = headerRe.exec(content)) !== null) {
      headers.push({
        type: m[1].toLowerCase(),
        id: m[2].trim(),
        headerStart: m.index,
        bodyStart: headerRe.lastIndex,
      });
    }
    for (let h = 0; h < headers.length; h++) {
      const hdr = headers[h];
      if (hdr.type === "string" || hdr.type === "preamble" || hdr.type === "comment")
        continue;
      const bodyEnd = h + 1 < headers.length ? headers[h + 1].headerStart : content.length;
      let body = content.slice(hdr.bodyStart, bodyEnd);
      body = body.replace(/\}\s*$/, "").trim();
      const entry = { ENTRYTYPE: hdr.type, ID: hdr.id };
      Object.assign(entry, parseEntryFields(body));
      entries.push(entry);
    }
    return entries;
  }

  function entriesToBib(entries) {
    const lines = [];
    const fieldOrder = ["title", "author", "journal", "booktitle", "year", "volume", "number", "pages", "doi", "howpublished", "publisher"];
    const indentPre = 4;
    const indentPost = 16;
    for (const entry of entries) {
      const type = entry.ENTRYTYPE || "misc";
      const id = entry.ID || "unknown";
      lines.push(`@${type}{${id},`);
      
      const printedFields = new Set();
      
      function formatField(k, v) {
        const prefix = " ".repeat(indentPre);
        const nameLen = k.length;
        const padLen = Math.max(1, indentPost - nameLen);
        const padding = " ".repeat(padLen);
        return `${prefix}${k}${padding}= {${v}},`;
      }

      for (const k of fieldOrder) {
        if (entry[k] !== undefined && entry[k] !== null) {
          lines.push(formatField(k, entry[k]));
          printedFields.add(k);
        }
      }
      
      for (const [k, v] of Object.entries(entry)) {
        if (k === "ENTRYTYPE" || k === "ID" || k.startsWith("_") || printedFields.has(k)) continue;
        lines.push(formatField(k, v));
      }
      lines.push("}\n");
    }
    return lines.join("\n");
  }

  // ─── Fuzzy matching ──────────────────────────────────────────────────
  function tokenSortRatio(a, b) {
    if (typeof fuzzball !== "undefined") return fuzzball.token_sort_ratio(a, b);
    a = a.toLowerCase(); b = b.toLowerCase();
    if (a === b) return 100;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 100;
    let matches = 0;
    for (let i = 0; i < shorter.length; i++)
      if (longer.includes(shorter[i])) matches++;
    return Math.round((matches / longer.length) * 100);
  }

  function titleSimilarity(a, b) {
    return tokenSortRatio(a.toLowerCase().trim(), b.toLowerCase().trim());
  }

  // ─── Normalization helpers ───────────────────────────────────────────
  function normalizeText(text) {
    if (!text) return "";
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim().replace(/\s+/g, " ");
  }

  function normalizeAuthorSet(authorStr) {
    if (!authorStr) return new Set();
    const norm = normalizeText(authorStr);
    const parts = norm.split(/\s+and\s+/);
    const names = new Set();
    for (let a of parts) {
      a = a.trim();
      if (!a) continue;
      if (a.includes(",")) names.add(a.split(",")[0].trim());
      else { const t = a.split(/\s+/); names.add(t[t.length - 1]); }
    }
    return names;
  }

  function titleCaseIfAllCaps(authorStr) {
    if (!authorStr) return authorStr;
    const parts = authorStr.split(/\s+and\s+/i);
    const converted = parts.map(author => {
      if (author === author.toUpperCase() && author !== author.toLowerCase()) {
        return author.replace(/[a-zA-ZÀ-ÿ]+/g, word => {
          if (word.toLowerCase() === "and") return "and";
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
      }
      return author;
    });
    return converted.join(" and ");
  }

  function getAuthorCompleteness(authorStr) {
    if (!authorStr) return { initials: 0, full: 0 };
    let s = stripLatex(authorStr).replace(/\./g, ". ");
    const words = s.split(/\s+/).filter(Boolean);
    let initials = 0;
    let full = 0;
    for (const w of words) {
      const cleanW = w.replace(/[,{}.]/g, "");
      if (!cleanW) continue;
      if (/^[A-Za-z]$/.test(cleanW)) {
        initials++;
      } else if (/^[A-Za-z]{2,}$/.test(cleanW)) {
        if (cleanW.toLowerCase() !== "and" && cleanW.toLowerCase() !== "von" && cleanW.toLowerCase() !== "de") {
          full++;
        }
      }
    }
    return { initials, full };
  }

  function isMoreComplete(origStr, foundStr) {
    const orig = getAuthorCompleteness(origStr);
    const found = getAuthorCompleteness(foundStr);
    if (found.full > orig.full) return true;
    if (found.full === orig.full && found.initials > orig.initials) return true;
    return false;
  }

  function normalizePages(p) { return p.trim().replace(/\s*-+\s*/g, "-"); }

  // ─── Field comparison ────────────────────────────────────────────────
  function compareAuthors(a, b) {
    const sa = normalizeAuthorSet(a), sb = normalizeAuthorSet(b);
    if (!sa.size && !sb.size) return 100;
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    for (const n of sa) if (sb.has(n)) inter++;
    return (inter / Math.max(sa.size, sb.size)) * 100;
  }

  function compareField(field, a, b) {
    const na = normalizeText(a), nb = normalizeText(b);
    if (!na && !nb) return 100;
    if (!na || !nb) return 0;
    if (field === "year" || field === "doi" || field === "ENTRYTYPE") return na === nb ? 100 : 0;
    if (field === "author") {
      const score = compareAuthors(a, b);
      if (score === 100) {
        if (normalizeText(a) !== normalizeText(b) && isMoreComplete(a, b)) {
          return 95;
        }
        return 100;
      }
      return score;
    }
    if (field === "pages") return normalizePages(na) === normalizePages(nb) ? 100 : tokenSortRatio(na, nb);
    return tokenSortRatio(na, nb);
  }

  function getAiaaPaperNumber(entry) {
    if (!entry) return null;
    if (entry.doi) {
      const doiMatch = entry.doi.match(/10\.2514\/6\.(\d+-\d+)/i);
      if (doiMatch) {
        let paperNum = doiMatch[1];
        const parts = paperNum.split("-");
        if (parts[0].length === 4) {
          const year = parseInt(parts[0], 10);
          if (year < 2000) {
            paperNum = parts[0].slice(-2) + "-" + parts[1];
          }
        }
        return paperNum;
      }
    }
    const fields = ["journal", "booktitle", "howpublished", "year"];
    const aiaaRe = /AIAA(?:\s+Paper)?\s*(\d{2,4}-\d+)/i;
    for (const f of fields) {
      if (entry[f]) {
        const m = entry[f].match(aiaaRe);
        if (m) {
          let paperNum = m[1];
          const parts = paperNum.split("-");
          if (parts[0].length === 4) {
            const year = parseInt(parts[0], 10);
            if (year < 2000) {
              paperNum = parts[0].slice(-2) + "-" + parts[1];
            }
          }
          return paperNum;
        }
      }
    }
    const isAiaaConf = (entry.journal && /AIAA/i.test(entry.journal) && /(scitech|aviation|aerospace|meeting|forum|conference)/i.test(entry.journal)) ||
                       (entry.booktitle && /AIAA/i.test(entry.booktitle) && /(scitech|aviation|aerospace|meeting|forum|conference)/i.test(entry.booktitle));
    if (isAiaaConf && entry.year) {
      const pageVal = (entry.pages || entry.number || "").trim();
      if (pageVal && /^\d+$/.test(pageVal)) {
        let yr = entry.year.trim();
        if (yr.length === 4) {
          const yearInt = parseInt(yr, 10);
          if (yearInt < 2000) {
            yr = yr.slice(-2);
          }
        }
        return yr + "-" + pageVal;
      }
    }
    return null;
  }

  function compareEntry(original, found) {
    const origTitle = original.title || "";
    const foundTitle = found.title || "";
    const titleScore = tokenSortRatio(normalizeTitle(origTitle), normalizeTitle(foundTitle));

    if (titleScore < TITLE_MATCH_THRESHOLD) {
      return { status: "needs_review", title_score: titleScore, field_diffs: [], suggested: found };
    }

    const foundJournal = found.journal || "";
    if (original.booktitle && !original.journal && foundJournal)
      found.booktitle = foundJournal;

    // Preserve original full author names if original author is more complete than found author
    if (original.author && found.author && isMoreComplete(found.author, original.author)) {
      found.author = original.author;
    }

    const foundIsPreprint = isPreprint(found);
    const fieldDiffs = [], enrichments = [];
    let hasDifference = false;

    // AIAA Paper detection
    const origAiaaNum = getAiaaPaperNumber(original);
    const foundAiaaNum = getAiaaPaperNumber(found);
    const aiaaPaperNum = foundAiaaNum || origAiaaNum;
    const isAiaa = !!aiaaPaperNum;

    if (isAiaa) {
      found._aiaaPaperNum = aiaaPaperNum;
      if (!found.publisher && !original.publisher) {
        found.publisher = "AIAA Paper " + aiaaPaperNum;
      }
    }

    for (const field of COMPARED_FIELDS) {
      const origVal = original[field] || "";
      const foundVal = found[field] || "";
      if (!origVal && !foundVal) continue;

      if (!origVal.trim() && foundVal.trim()) {
        enrichments.push({ field, original: origVal, found: foundVal, score: 0 });
        continue;
      }
      if (origVal.trim() && !foundVal.trim()) {
        continue;
      }

      // The found record is a preprint (e.g. arXiv), whose `year` is the
      // submission year. If the user's year is the same or newer, it's the
      // peer-reviewed publication year — keep it instead of suggesting the
      // older preprint year.
      if (field === "year" && foundIsPreprint && isNewerOrSamePublicationYear(origVal, foundVal)) {
        continue;
      }

      const score = compareField(field, origVal, foundVal);
      if (score < 100) {
        hasDifference = true;
        fieldDiffs.push({ field, original: origVal, found: foundVal, score: Math.round(score * 10) / 10 });
      }
    }

    const allDiffs = fieldDiffs.concat(enrichments);
    // Any actionable suggestion (mismatch or enrichment) means the entry is
    // auto-updated, not verified — "verified" is reserved for entries with
    // nothing for the user to review.
    const status = (hasDifference || enrichments.length) ? "updated" : "verified";
    const suggested = {};
    if (hasDifference || enrichments.length) {
      for (const d of allDiffs) {
        if (d.suggestedRemove) {
          suggested[d.field] = null;
        } else if (d.found !== undefined) {
          suggested[d.field] = d.found;
        }
      }
    }

    return { status, title_score: Math.round(titleScore * 10) / 10, field_diffs: allDiffs, suggested };
  }

  /**
   * When compareEntry returns needs_review (title below threshold), field_diffs is empty.
   * Build a full diff against the closest `found` record so the UI can show suggestions
   * and per-field accept / revert actions.
   */
  function fieldDiffsForNeedsReview(original, found) {
    if (!found) return [];
    const merged = { ...found };
    const foundJournal = merged.journal || "";
    if (original.booktitle && !original.journal && foundJournal)
      merged.booktitle = foundJournal;

    if (original.author && merged.author && isMoreComplete(merged.author, original.author)) {
      merged.author = original.author;
    }

    const origTitle = original.title || "";
    const foundTitle = merged.title || "";
    const titleScore = tokenSortRatio(normalizeTitle(origTitle), normalizeTitle(foundTitle));
    const fieldDiffs = [];
    const enrichments = [];

    if (origTitle.trim() || foundTitle.trim()) {
      fieldDiffs.push({
        field: "title",
        original: origTitle,
        found: foundTitle,
        score: Math.round(titleScore * 10) / 10,
      });
    }

    // AIAA Paper detection
    const origAiaaNum = getAiaaPaperNumber(original);
    const foundAiaaNum = getAiaaPaperNumber(merged);
    const aiaaPaperNum = foundAiaaNum || origAiaaNum;
    const isAiaa = !!aiaaPaperNum;

    if (isAiaa) {
      merged.ENTRYTYPE = "misc";
      merged.howpublished = "AIAA Paper " + aiaaPaperNum;
      const removeFields = ["journal", "booktitle", "volume", "number", "pages", "publisher"];
      for (const f of removeFields) {
        merged[f] = "";
      }
    }

    for (const field of COMPARED_FIELDS) {
      const origVal = original[field] || "";
      const foundVal = merged[field] || "";
      if (!origVal && !foundVal) continue;

      const isAiaaRemove = isAiaa && ["journal", "booktitle", "volume", "number", "pages", "publisher"].includes(field);

      if (!origVal.trim() && foundVal.trim()) {
        enrichments.push({ field, original: origVal, found: foundVal, score: 0 });
        continue;
      }
      if (origVal.trim() && !foundVal.trim()) {
        if (isAiaaRemove) {
          fieldDiffs.push({ field, original: origVal, found: "", score: 0, suggestedRemove: true });
        }
        continue;
      }

      const score = compareField(field, origVal, foundVal);
      if (score < 100) {
        fieldDiffs.push({
          field,
          original: origVal,
          found: foundVal,
          score: Math.round(score * 10) / 10,
        });
      }
    }

    return fieldDiffs.concat(enrichments);
  }

  // ─── API response converters ─────────────────────────────────────────
  function crossrefToStandard(item) {
    const authors = (item.author || []).map(a => {
      const f = a.family || "", g = a.given || "";
      return f ? `${f}, ${g}`.replace(/, $/, "") : "";
    }).filter(Boolean);

    const dp = item["published-print"] || item["published-online"] || {};
    const year = dp["date-parts"]?.[0]?.[0]?.toString() || "";
    const container = item["container-title"] || [];

    return {
      title: (item.title || [""])[0],
      author: titleCaseIfAllCaps(authors.join(" and ")),
      year,
      journal: cleanVenue(container[0] || ""),
      volume: item.volume || "",
      number: item.issue || "",
      pages: item.page || "",
      doi: item.DOI || "",
      publisher: item.publisher || "",
      url: item.URL || "",
      _source: "crossref",
    };
  }

  function ssToStandard(paper) {
    const authors = (paper.authors || []).map(a => {
      const name = a.name || "";
      const parts = name.split(/\s+/);
      if (parts.length >= 2) return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
      return name;
    }).filter(Boolean);

    const ext = paper.externalIds || {};
    const pv = paper.publicationVenue;
    let venue = (pv && typeof pv === "object" ? pv.name : null) || paper.venue || "";
    // Surface arXiv-only records so downstream logic can treat them as
    // preprints — their `year` is the submission year, not the published one.
    if (!venue && ext.ArXiv) venue = "arXiv";

    return {
      title: paper.title || "",
      author: titleCaseIfAllCaps(authors.join(" and ")),
      year: (paper.year || "").toString(),
      journal: cleanVenue(venue),
      volume: "", number: "", pages: "",
      doi: ext.DOI || "",
      publisher: "",
      url: ext.DOI ? `https://doi.org/${ext.DOI}` : "",
      _source: "semantic_scholar",
    };
  }

  function openAlexToStandard(work) {
    const authors = (work.authorships || []).map(a => {
      const name = (a.author && a.author.display_name) || "";
      const parts = name.split(/\s+/);
      if (parts.length >= 2) return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
      return name;
    }).filter(Boolean);

    const source = (work.primary_location && work.primary_location.source) || {};
    const biblio = work.biblio || {};
    const first = biblio.first_page || "";
    const last = biblio.last_page || "";
    const pages = first && last ? `${first}-${last}` : (first || last || "");
    // OpenAlex reports DOIs as full URLs (https://doi.org/10.x); store the bare DOI.
    const rawDoi = work.doi || work.ids?.doi || "";
    const doi = (rawDoi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");

    return {
      title: work.title || work.display_name || "",
      author: titleCaseIfAllCaps(authors.join(" and ")),
      year: (work.publication_year || "").toString(),
      journal: cleanVenue(source.display_name || ""),
      volume: biblio.volume || "",
      number: biblio.issue || "",
      pages,
      doi,
      publisher: source.host_organization_name || "",
      url: doi ? `https://doi.org/${doi}` : (work.id || ""),
      _source: "openalex",
    };
  }

  // ─── Paper matching helpers ──────────────────────────────────────────
  function extractLastNames(authorStr) {
    if (!authorStr) return new Set();
    const names = new Set();
    for (let part of authorStr.split(/\s+and\s+/i)) {
      part = part.trim();
      if (!part) continue;
      if (part.includes(",")) names.add(part.split(",")[0].trim().toLowerCase());
      else { const t = part.split(/\s+/); names.add(t[t.length - 1].toLowerCase()); }
    }
    return names;
  }

  // ─── Preprint awareness ──────────────────────────────────────────────
  // Fields where the peer-reviewed record should win when merged with a
  // preprint version of the same paper.
  const PUBLISHED_PREFERRED_FIELDS = ["year", "journal", "volume", "number", "pages", "publisher", "doi"];
  // Preprint and published versions of the same paper rarely differ by more
  // than a couple of years; allow this gap when cross-referencing sources.
  const PREPRINT_YEAR_TOLERANCE = 2;

  /**
   * True when a standard record looks like an arXiv (or similar) preprint.
   * Preprints report the submission year, which is usually earlier than the
   * peer-reviewed publication year.
   */
  function isPreprint(record) {
    if (!record) return false;
    const doi = (record.doi || "").toLowerCase();
    if (doi.startsWith("10.48550/arxiv")) return true;
    const venue = (record.journal || "").toLowerCase().trim();
    if (/\barxiv\b/.test(venue)) return true;
    if (venue === "corr" || venue.includes("computing research repository")) return true;
    const url = (record.url || "").toLowerCase();
    if (url.includes("arxiv.org")) return true;
    return false;
  }

  /**
   * True when `origYear` is the same as, or a little newer than, `foundYear` —
   * i.e. the user's year plausibly reflects the published version of a paper
   * whose `found` record is an earlier preprint.
   */
  function isNewerOrSamePublicationYear(origYear, foundYear) {
    const oy = parseInt(origYear, 10), fy = parseInt(foundYear, 10);
    if (!Number.isFinite(oy) || !Number.isFinite(fy)) return false;
    return oy >= fy && oy - fy <= PREPRINT_YEAR_TOLERANCE + 1;
  }

  function isSamePaper(a, b) {
    if (titleSimilarity(a.title || "", b.title || "") < 85) return false;
    if (a.year && b.year) {
      const ya = parseInt(a.year, 10), yb = parseInt(b.year, 10);
      if (Number.isFinite(ya) && Number.isFinite(yb) &&
          Math.abs(ya - yb) > PREPRINT_YEAR_TOLERANCE) return false;
    }
    const aa = extractLastNames(a.author), ba = extractLastNames(b.author);
    if (aa.size && ba.size) {
      let inter = 0; for (const n of aa) if (ba.has(n)) inter++;
      if (inter / Math.max(aa.size, ba.size) < 0.3) return false;
    }
    return true;
  }

  function mergeMetadata(primary, secondary) {
    const merged = { ...primary };
    for (const [k, v] of Object.entries(secondary)) {
      if (k.startsWith("_")) continue;
      if (k === "author") {
        if (!merged.author) {
          merged.author = v;
        } else if (v && isMoreComplete(merged.author, v)) {
          merged.author = v;
        }
      } else {
        if (!merged[k] && v) merged[k] = v;
      }
    }
    // When a preprint (primary) is merged with its published version
    // (secondary), trust the published venue for bibliographic fields —
    // above all `year`, which on a preprint is the earlier submission year.
    if (isPreprint(primary) && !isPreprint(secondary)) {
      for (const f of PUBLISHED_PREFERRED_FIELDS) {
        if (secondary[f]) merged[f] = secondary[f];
      }
    }
    merged._source = `${primary._source || ""}+${secondary._source || ""}`;
    return merged;
  }

  function bestMatch(candidates, queryTitle) {
    let best = null, bestScore = 0;
    for (const c of candidates) {
      const s = titleSimilarity(queryTitle, c.title || "");
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best && bestScore >= MIN_TITLE_SIM ? best : null;
  }

  // ─── Venue abbreviation ──────────────────────────────────────────────
  const VENUE_LOWERCASE_WORDS = new Set([
    "a", "an", "the",
    "and", "but", "or", "nor", "for", "yet", "so",
    "of", "in", "on", "at", "by", "for", "with", "to", "from", "into", "via", "per", "as", "about", "over", "under", "through"
  ]);

  const VENUE_KNOWN_ACRONYMS = new Map([
    ["ieee", "IEEE"],
    ["acm", "ACM"],
    ["aiaa", "AIAA"],
    ["siam", "SIAM"],
    ["asme", "ASME"],
    ["aps", "APS"],
    ["jfm", "JFM"],
    ["eccomas", "ECCOMAS"],
    ["iutam", "IUTAM"],
    ["nasa", "NASA"],
    ["nato", "NATO"],
    ["a&a", "A&A"],
    ["prl", "PRL"],
    ["pre", "PRE"],
    ["3d", "3D"],
    ["2d", "2D"],
    ["cfd", "CFD"],
    ["les", "LES"],
    ["dns", "DNS"],
    ["rans", "RANS"],
    ["ai", "AI"],
    ["ml", "ML"],
    ["nlp", "NLP"],
    ["cv", "CV"],
    ["arxiv", "arXiv"],
  ]);

  function capitalizeVenueWord(word, isFirst, isLast) {
    if (!word) return "";
    const lower = word.toLowerCase();

    if (VENUE_KNOWN_ACRONYMS.has(lower)) {
      return VENUE_KNOWN_ACRONYMS.get(lower);
    }

    if (word === word.toUpperCase() && /[A-Z]/.test(word) && word.length > 1) {
      return word;
    }

    if (/[a-z][A-Z]/.test(word)) {
      return word;
    }

    if (word.includes("-")) {
      return word
        .split("-")
        .map((part, idx, arr) => capitalizeVenueWord(part, isFirst && idx === 0, isLast && idx === arr.length - 1))
        .join("-");
    }

    if (!isFirst && !isLast && VENUE_LOWERCASE_WORDS.has(lower)) {
      return lower;
    }

    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function capitalizeVenue(name) {
    if (!name) return "";
    const tokens = name.split(/(\s+)/);
    const nonSpaceIndices = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!/^\s*$/.test(tokens[i])) {
        nonSpaceIndices.push(i);
      }
    }
    if (nonSpaceIndices.length === 0) return name;

    for (let idx = 0; idx < nonSpaceIndices.length; idx++) {
      const i = nonSpaceIndices[idx];
      const isFirst = (idx === 0);
      const isLast = (idx === nonSpaceIndices.length - 1);
      tokens[i] = capitalizeVenueWord(tokens[i], isFirst, isLast);
    }

    return tokens.join("");
  }

  function cleanVenue(name) {
    if (!name) return "";
    let clean = name.trim();
    // Strip leading "The " or "the " case-insensitively
    clean = clean.replace(/^[Tt]he\s+/, "");

    // Match case-insensitively against known venue keys in VENUE_ABBREVIATIONS
    const cleanNormalized = clean.toLowerCase().replace(/[^a-z0-9\s&,]/g, "");
    for (const full of Object.keys(VENUE_ABBREVIATIONS)) {
      const fullNormalized = full.toLowerCase().replace(/[^a-z0-9\s&,]/g, "");
      if (cleanNormalized === fullNormalized) {
        return full;
      }
    }

    return capitalizeVenue(clean);
  }

  const VENUE_ABBREVIATIONS = {
    // Fluid Dynamics, Aerodynamics, Aerospace & Propulsion
    "Physics of Fluids": "Phys. Fluids",
    "Journal of Fluid Mechanics": "J. Fluid Mech.",
    "Journal of Computational Physics": "J. Comput. Phys.",
    "AIAA Journal": "AIAA J.",
    "Journal of Aircraft": "J. Aircr.",
    "Journal of Propulsion and Power": "J. Propuls. Power",
    "Journal of Spacecraft and Rockets": "J. Spacecr. Rockets",
    "Journal of Turbulence": "J. Turbul.",
    "Experiments in Fluids": "Exp. Fluids",
    "Computers & Fluids": "Comput. Fluids",
    "Annual Review of Fluid Mechanics": "Annu. Rev. Fluid Mech.",
    "Physical Review Fluids": "Phys. Rev. Fluids",
    "Experimental Thermal and Fluid Science": "Exp. Therm. Fluid Sci.",
    "International Journal of Heat and Fluid Flow": "Int. J. Heat Fluid Flow",
    "Journal of Aerospace Engineering": "J. Aerosp. Eng.",
    "Aerospace Science and Technology": "Aerosp. Sci. Technol.",
    "Progress in Aerospace Sciences": "Prog. Aerosp. Sci.",
    "Fluid Dynamics Research": "Fluid Dyn. Res.",
    "European Journal of Mechanics - B/Fluids": "Eur. J. Mech. B Fluids",
    "International Journal of Multiphase Flow": "Int. J. Multiphase Flow",
    "Theoretical and Computational Fluid Dynamics": "Theor. Comput. Fluid Dyn.",
    "Flow, Turbulence and Combustion": "Flow Turbul. Combust.",
    "Combustion and Flame": "Combust. Flame",
    "Proceedings of the Combustion Institute": "Proc. Combust. Inst.",
    "Journal of Fluid Science and Technology": "J. Fluid Sci. Technol.",

    // Thermal Sciences, Heat Transfer & Energy
    "Journal of Heat Transfer": "J. Heat Transfer",
    "International Journal of Heat and Mass Transfer": "Int. J. Heat Mass Transfer",
    "International Journal of Thermal Sciences": "Int. J. Therm. Sci.",
    "Applied Thermal Engineering": "Appl. Therm. Eng.",
    "Heat and Mass Transfer": "Heat Mass Transfer",
    "Numerical Heat Transfer, Part A: Applications": "Numer. Heat Transfer, Part A",
    "Numerical Heat Transfer, Part B: Fundamentals": "Numer. Heat Transfer, Part B",
    "Energy": "Energy",
    "Applied Energy": "Appl. Energy",
    "Renewable and Sustainable Energy Reviews": "Renewable Sustainable Energy Rev.",
    "Progress in Energy and Combustion Science": "Prog. Energy Combust. Sci.",

    // Physics, Mechanics & General Science
    "Physical Review Letters": "Phys. Rev. Lett.",
    "Physical Review A": "Phys. Rev. A",
    "Physical Review B": "Phys. Rev. B",
    "Physical Review C": "Phys. Rev. C",
    "Physical Review D": "Phys. Rev. D",
    "Physical Review E": "Phys. Rev. E",
    "Physical Review X": "Phys. Rev. X",
    "Physical Review Applied": "Phys. Rev. Appl.",
    "Physical Review Research": "Phys. Rev. Res.",
    "Physical Review Materials": "Phys. Rev. Mater.",
    "Physical Review": "Phys. Rev.",
    "Reviews of Modern Physics": "Rev. Mod. Phys.",
    "Applied Physics Letters": "Appl. Phys. Lett.",
    "Journal of Applied Physics": "J. Appl. Phys.",
    "Journal of Physics A: Mathematical and Theoretical": "J. Phys. A: Math. Theor.",
    "Journal of Physics D: Applied Physics": "J. Phys. D: Appl. Phys.",
    "Reports on Progress in Physics": "Rep. Prog. Phys.",
    "Europhysics Letters": "EPL",
    "European Physical Journal E": "Eur. Phys. J. E",
    "Philosophical Transactions of the Royal Society A": "Phil. Trans. R. Soc. A",
    "Philosophical Transactions of the Royal Society A: Mathematical, Physical and Engineering Sciences": "Phil. Trans. R. Soc. A",
    "Philosophical Transactions of the Royal Society B": "Phil. Trans. R. Soc. B",
    "Philosophical Transactions of the Royal Society": "Phil. Trans.",
    "Proceedings of the Royal Society A": "Proc. R. Soc. A",
    "Proceedings of the Royal Society A: Mathematical, Physical and Engineering Sciences": "Proc. R. Soc. A",
    "Proceedings of the National Academy of Sciences": "Proc. Natl. Acad. Sci. U.S.A.",

    // Mechanical & Materials Engineering, Numerical Methods
    "Journal of Sound and Vibration": "J. Sound Vib.",
    "Journal of Vibration and Acoustics": "J. Vib. Acoust.",
    "Journal of Applied Mechanics": "J. Appl. Mech.",
    "International Journal of Solids and Structures": "Int. J. Solids Struct.",
    "Journal of the Mechanics and Physics of Solids": "J. Mech. Phys. Solids",
    "Mechanics of Materials": "Mech. Mater.",
    "Acta Materialia": "Acta Mater.",
    "Scripta Materialia": "Scripta Mater.",
    "Materials Science and Engineering: A": "Mater. Sci. Eng., A",
    "Composites Science and Technology": "Compos. Sci. Technol.",
    "Composites Part A: Applied Science and Manufacturing": "Compos. Part A Appl. Sci. Manuf.",
    "Composites Part B: Engineering": "Compos. Part B Eng.",
    "IEEE Transactions on Automatic Control": "IEEE Trans. Autom. Control",
    "IEEE Transactions on Robotics": "IEEE Trans. Rob.",
    "IEEE Control Systems Magazine": "IEEE Control Syst. Mag.",
    "Automatica": "Automatica",
    "SIAM Journal on Control and Optimization": "SIAM J. Control Optim.",
    "SIAM Journal on Applied Mathematics": "SIAM J. Appl. Math.",
    "SIAM Journal on Numerical Analysis": "SIAM J. Numer. Anal.",
    "SIAM Journal on Scientific Computing": "SIAM J. Sci. Comput.",
    "Journal of Scientific Computing": "J. Sci. Comput.",
    "Computer Methods in Applied Mechanics and Engineering": "Comput. Methods Appl. Mech. Eng.",
    "International Journal for Numerical Methods in Engineering": "Int. J. Numer. Methods Eng.",
    "International Journal for Numerical Methods in Fluids": "Int. J. Numer. Methods Fluids",

    // Chemistry & Chemical Engineering
    "Journal of the American Chemical Society": "J. Am. Chem. Soc.",
    "Chemical Reviews": "Chem. Rev.",
    "Accounts of Chemical Research": "Acc. Chem. Res.",
    "Angewandte Chemie International Edition": "Angew. Chem. Int. Ed.",
    "Chemical Engineering Science": "Chem. Eng. Sci.",
    "Industrial & Engineering Chemistry Research": "Ind. Eng. Chem. Res.",
    "AIChE Journal": "AIChE J.",
    "Journal of Physical Chemistry A": "J. Phys. Chem. A",
    "Journal of Physical Chemistry B": "J. Phys. Chem. B",
    "Journal of Physical Chemistry C": "J. Phys. Chem. C",
    "The Journal of Chemical Physics": "J. Chem. Phys.",

    // Computer Science & AI Conferences/Journals
    "Advances in Neural Information Processing Systems": "NeurIPS",
    "Neural Information Processing Systems": "NeurIPS",
    "International Conference on Machine Learning": "ICML",
    "International Conference on Learning Representations": "ICLR",
    "Association for Computational Linguistics": "ACL",
    "Conference on Empirical Methods in Natural Language Processing": "EMNLP",
    "North American Chapter of the Association for Computational Linguistics": "NAACL",
    "IEEE Conference on Computer Vision and Pattern Recognition": "CVPR",
    "Computer Vision and Pattern Recognition": "CVPR",
    "IEEE International Conference on Computer Vision": "ICCV",
    "International Conference on Computer Vision": "ICCV",
    "European Conference on Computer Vision": "ECCV",
    "AAAI Conference on Artificial Intelligence": "AAAI",
    "International Joint Conference on Artificial Intelligence": "IJCAI",
    "ACM SIGKDD International Conference on Knowledge Discovery and Data Mining": "KDD",
    "International Conference on Very Large Data Bases": "VLDB",
    "Very Large Data Bases": "VLDB",
    "ACM SIGMOD International Conference on Management of Data": "SIGMOD",
    "IEEE Transactions on Pattern Analysis and Machine Intelligence": "TPAMI",
    "Journal of Machine Learning Research": "JMLR",
    "Artificial Intelligence": "AI",
    "Transactions on Graphics": "TOG",
    "ACM Computing Surveys": "CSUR",
    "IEEE Transactions on Neural Networks and Learning Systems": "TNNLS",
    "IEEE Transactions on Image Processing": "TIP",
    "IEEE Transactions on Signal Processing": "TSP",
    "Nature Machine Intelligence": "Nat. Mach. Intell.",
    "International Conference on Acoustics, Speech and Signal Processing": "ICASSP",
    "ACM Conference on Human Factors in Computing Systems": "CHI",
    "Usenix Security Symposium": "USENIX Security",
    "IEEE Symposium on Security and Privacy": "IEEE S&P",
    "ACM Conference on Computer and Communications Security": "CCS",
    "International World Wide Web Conference": "WWW",
  };

  function abbreviateVenue(name) {
    if (!name) return name;
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9\s&,]/g, "");
    for (const [full, abbr] of Object.entries(VENUE_ABBREVIATIONS)) {
      const fullClean = full.toLowerCase().replace(/[^a-z0-9\s&,]/g, "");
      if (clean === fullClean || clean.includes(fullClean)) return abbr;
    }
    return cleanVenue(name);
  }

  function expandVenue(name) {
    if (!name) return name;
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9\s&,]/g, "");
    for (const [full, abbr] of Object.entries(VENUE_ABBREVIATIONS)) {
      const abbrClean = abbr.toLowerCase().replace(/[^a-z0-9\s&,]/g, "");
      if (clean === abbrClean) return full;
    }
    return cleanVenue(name);
  }

  // ─── Title casing utilities ──────────────────────────────────────────
  const TITLE_KNOWN_ACRONYMS = new Map([
    ["dns", "DNS"], ["les", "LES"], ["rans", "RANS"], ["cfd", "CFD"],
    ["aiaa", "AIAA"], ["ieee", "IEEE"], ["acm", "ACM"], ["jfm", "JFM"], ["pof", "POF"],
    ["siam", "SIAM"], ["asme", "ASME"], ["aps", "APS"],
    ["3d", "3D"], ["2d", "2D"], ["nasa", "NASA"], ["nato", "NATO"],
    ["gpu", "GPU"], ["cpu", "CPU"], ["ai", "AI"], ["ml", "ML"],
    ["cnn", "CNN"], ["rnn", "RNN"], ["lstm", "LSTM"], ["bert", "BERT"],
    ["llm", "LLM"], ["gpt", "GPT"], ["arxiv", "arXiv"],
    ["i", "I"], ["ii", "II"], ["iii", "III"], ["iv", "IV"], ["v", "V"],
    ["vi", "VI"], ["vii", "VII"], ["viii", "VIII"], ["ix", "IX"], ["x", "X"],
  ]);

  const TITLE_LOWERCASE_WORDS = new Set([
    "a", "an", "the",
    "and", "but", "or", "nor", "for", "yet", "so",
    "of", "in", "on", "at", "by", "for", "with", "to", "from", "into", "via", "per", "as", "about", "over", "under", "through"
  ]);

  function toTitleCaseWord(word, isFirst, isLast, afterMajorPunctuation) {
    if (!word) return "";
    if ((word.startsWith("{") && word.endsWith("}")) || word.includes("$") || word.startsWith("\\")) {
      return word;
    }

    const match = /^([^\w]*)([\w-]+)([^\w]*)$/.exec(word);
    if (!match) return word;
    const [, prefix, core, suffix] = match;

    const lower = core.toLowerCase();
    let resultCore = core;

    if (TITLE_KNOWN_ACRONYMS.has(lower)) {
      resultCore = TITLE_KNOWN_ACRONYMS.get(lower);
    } else if (core === core.toUpperCase() && /[A-Z]/.test(core) && core.length > 1) {
      resultCore = core;
    } else if (/[a-z][A-Z]/.test(core)) {
      resultCore = core;
    } else if (core.includes("-")) {
      resultCore = core
        .split("-")
        .map((part, idx, arr) => toTitleCaseWord(part, isFirst && idx === 0, isLast && idx === arr.length - 1, false))
        .join("-");
    } else if (!isFirst && !isLast && !afterMajorPunctuation && TITLE_LOWERCASE_WORDS.has(lower)) {
      resultCore = lower;
    } else {
      resultCore = lower.charAt(0).toUpperCase() + lower.slice(1);
    }

    return prefix + resultCore + suffix;
  }

  function toTitleCase(title) {
    if (!title) return "";
    const tokens = title.split(/(\s+)/);
    const nonSpaceIndices = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!/^\s*$/.test(tokens[i])) {
        nonSpaceIndices.push(i);
      }
    }
    if (nonSpaceIndices.length === 0) return title;

    let afterPunct = false;
    for (let idx = 0; idx < nonSpaceIndices.length; idx++) {
      const i = nonSpaceIndices[idx];
      const isFirst = (idx === 0);
      const isLast = (idx === nonSpaceIndices.length - 1);

      tokens[i] = toTitleCaseWord(tokens[i], isFirst, isLast, afterPunct);

      const raw = tokens[i];
      afterPunct = /[:\.\?!-]\s*$/.test(raw) || /:$/.test(raw);
    }

    return tokens.join("");
  }

  function toSentenceCaseWord(word, isFirst, afterMajorPunctuation) {
    if (!word) return "";
    if ((word.startsWith("{") && word.endsWith("}")) || word.includes("$") || word.startsWith("\\")) {
      return word;
    }

    const match = /^([^\w]*)([\w-]+)([^\w]*)$/.exec(word);
    if (!match) return word;
    const [, prefix, core, suffix] = match;

    const lower = core.toLowerCase();
    let resultCore = core;

    if (TITLE_KNOWN_ACRONYMS.has(lower)) {
      resultCore = TITLE_KNOWN_ACRONYMS.get(lower);
    } else if (core === core.toUpperCase() && /[A-Z]/.test(core) && core.length > 1) {
      resultCore = core;
    } else if (/[a-z][A-Z]/.test(core)) {
      resultCore = core;
    } else if (core.includes("-")) {
      resultCore = core
        .split("-")
        .map((part, idx) => toSentenceCaseWord(part, isFirst && idx === 0, false))
        .join("-");
    } else if (isFirst || afterMajorPunctuation) {
      resultCore = lower.charAt(0).toUpperCase() + lower.slice(1);
    } else {
      resultCore = lower;
    }

    return prefix + resultCore + suffix;
  }

  function toSentenceCase(title) {
    if (!title) return "";
    const tokens = title.split(/(\s+)/);
    const nonSpaceIndices = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!/^\s*$/.test(tokens[i])) {
        nonSpaceIndices.push(i);
      }
    }
    if (nonSpaceIndices.length === 0) return title;

    let afterPunct = false;
    for (let idx = 0; idx < nonSpaceIndices.length; idx++) {
      const i = nonSpaceIndices[idx];
      const isFirst = (idx === 0);

      tokens[i] = toSentenceCaseWord(tokens[i], isFirst, afterPunct);

      const raw = tokens[i];
      afterPunct = /[:\.\?!-]\s*$/.test(raw) || /:$/.test(raw);
    }

    return tokens.join("");
  }

  // ─── Note cleaning ───────────────────────────────────────────────────
  // Reference managers (Zotero, Mendeley, Scopus exports, …) dump their own
  // bookkeeping into `note` / `annote`. It is never part of the citation and
  // shows up verbatim in the compiled bibliography, so offer to strip it.
  // Keys are matched case-insensitively; `_` also matches the LaTeX-escaped
  // `\_` that managers write, and a space matches any run of whitespace.
  const NOTE_JUNK_KEYS = [
    "read_status_date",
    "read_status",
    "citation key",
    "kerkocite.itemalsoknownas",
    "zscc",
    "mag id",
    "tex.ids",
    "export date",
    "cited by",
    "cited references",
    "correspondence address",
    "art. no",
    "coden",
  ];

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const NOTE_JUNK_KEY_RE = new RegExp(
    "(?:^|(?<=[\\s;,]))(?:" +
      NOTE_JUNK_KEYS.map(k => escapeRegExp(k).replace(/_/g, "\\\\?_").replace(/ /g, "\\s+")).join("|") +
      ")\\s*:",
    "gi"
  );

  /**
   * Strip reference-manager bookkeeping (`Read_Status: Read`, `ZSCC: 0`, …)
   * from a note value, keeping any prose the user actually wrote. A junk
   * value ends at the next junk key, the next newline, or the end of the note
   * — whichever comes first — because BibTeX parsing may have collapsed the
   * manager's line breaks into spaces.
   */
  function cleanNote(note) {
    if (!note) return "";
    const text = String(note);
    NOTE_JUNK_KEY_RE.lastIndex = 0;
    const starts = [];
    let m;
    while ((m = NOTE_JUNK_KEY_RE.exec(text)) !== null) starts.push(m.index);
    if (!starts.length) return text.trim();

    let kept = "";
    let cursor = 0;
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      if (start < cursor) continue;
      const limit = i + 1 < starts.length ? starts[i + 1] : text.length;
      const nl = text.indexOf("\n", start);
      const end = nl !== -1 && nl < limit ? nl : limit;
      kept += text.slice(cursor, start);
      cursor = end;
    }
    kept += text.slice(cursor);
    return kept.replace(/[\s;,]+/g, " ").trim().replace(/^[;,]+|[;,]+$/g, "").trim();
  }

  /**
   * Return a copy of an entry with note-like fields cleaned; fields left empty
   * by the cleaning are dropped entirely.
   */
  function cleanEntryNotes(entry) {
    const out = { ...entry };
    for (const field of ["note", "annote"]) {
      if (!(field in out)) continue;
      const cleaned = cleanNote(out[field]);
      if (cleaned) out[field] = cleaned;
      else delete out[field];
    }
    return out;
  }

  // ─── Key generation ──────────────────────────────────────────────────
  const STOP_WORDS = new Set([
    "a", "an", "the",
    "and", "but", "or", "nor", "for", "yet", "so",
    "although", "because", "since", "unless", "until", "while", "if",
    "about", "above", "across", "after", "against", "along", "among", "around", "at", 
    "before", "behind", "below", "beneath", "beside", "between", "beyond", "by", 
    "down", "during", "except", "from", "in", "inside", "into", "like", "near", 
    "of", "off", "on", "onto", "out", "outside", "over", "past", "through", 
    "throughout", "to", "toward", "under", "underneath", "until", "up", "upon", 
    "with", "within", "without"
  ]);

  function generateCitationKey(entry) {
    let lastName = "";
    if (entry.author) {
      const firstAuthor = entry.author.split(/\s+and\s+/i)[0].trim();
      if (firstAuthor.includes(",")) {
        lastName = firstAuthor.split(",")[0].trim();
      } else {
        const parts = firstAuthor.split(/\s+/);
        lastName = parts[parts.length - 1];
      }
    }
    lastName = normalizeText(lastName).replace(/[^a-z0-9]/g, "");
    if (!lastName) lastName = "unknown";

    let year = (entry.year || "").replace(/[^0-9]/g, "").slice(0, 4) || "0000";

    let titleWord = "paper";
    if (entry.title) {
      const cleanedTitle = stripLatex(entry.title).toLowerCase();
      const words = cleanedTitle.match(/[a-z0-9]+/g) || [];
      for (const w of words) {
        if (!STOP_WORDS.has(w) && w.length > 2) {
          titleWord = w;
          break;
        }
      }
      if (titleWord === "paper" && words.length > 0) {
        titleWord = words[0];
      }
    }

    return `${lastName}${year}${titleWord}`;
  }

  // ─── Search ──────────────────────────────────────────────────────────
  /**
   * Case-insensitive AND-of-tokens substring match against an entry's title
   * and BibTeX key. Empty/whitespace queries always match. Supports
   * field-qualified tokens `title:foo` and `id:bar` for power users.
   */
  function entryMatchesQuery(entry, query) {
    if (!query) return true;
    const q = String(query).trim().toLowerCase();
    if (!q) return true;
    const title = stripLatex(entry.title || "").toLowerCase();
    const id = (entry.entry_id || entry.ID || "").toLowerCase();
    const haystack = `${id} ${title}`;
    const tokens = q.split(/\s+/).filter(Boolean);
    return tokens.every(tok => {
      if (tok.startsWith("title:")) return title.includes(tok.slice(6));
      if (tok.startsWith("id:") || tok.startsWith("key:"))
        return id.includes(tok.slice(tok.indexOf(":") + 1));
      return haystack.includes(tok);
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────
  exports.TITLE_MATCH_THRESHOLD = TITLE_MATCH_THRESHOLD;
  exports.MIN_TITLE_SIM = MIN_TITLE_SIM;
  exports.COMPARED_FIELDS = COMPARED_FIELDS;
  exports.VENUE_ABBREVIATIONS = VENUE_ABBREVIATIONS;

  exports.stripLatex = stripLatex;
  exports.normalizeTitle = normalizeTitle;
  exports.parseBib = parseBib;
  exports.entriesToBib = entriesToBib;
  exports.tokenSortRatio = tokenSortRatio;
  exports.titleSimilarity = titleSimilarity;
  exports.normalizeText = normalizeText;
  exports.normalizeAuthorSet = normalizeAuthorSet;
  exports.getAuthorCompleteness = getAuthorCompleteness;
  exports.isMoreComplete = isMoreComplete;
  exports.getAiaaPaperNumber = getAiaaPaperNumber;
  exports.normalizePages = normalizePages;
  exports.compareAuthors = compareAuthors;
  exports.compareField = compareField;
  exports.compareEntry = compareEntry;
  exports.fieldDiffsForNeedsReview = fieldDiffsForNeedsReview;
  exports.crossrefToStandard = crossrefToStandard;
  exports.ssToStandard = ssToStandard;
  exports.openAlexToStandard = openAlexToStandard;
  exports.extractLastNames = extractLastNames;
  exports.isPreprint = isPreprint;
  exports.isSamePaper = isSamePaper;
  exports.mergeMetadata = mergeMetadata;
  exports.bestMatch = bestMatch;
  exports.abbreviateVenue = abbreviateVenue;
  exports.expandVenue = expandVenue;
  exports.cleanNote = cleanNote;
  exports.cleanEntryNotes = cleanEntryNotes;
  exports.NOTE_JUNK_KEYS = NOTE_JUNK_KEYS;
  exports.entryMatchesQuery = entryMatchesQuery;
  exports.titleCaseIfAllCaps = titleCaseIfAllCaps;
  exports.cleanVenue = cleanVenue;
  exports.capitalizeVenue = capitalizeVenue;
  exports.toTitleCase = toTitleCase;
  exports.toSentenceCase = toSentenceCase;
  exports.generateCitationKey = generateCitationKey;

})(typeof module !== "undefined" && module.exports ? module.exports : (window.BibLib = {}));
