/**
 * PDF text extraction — the first step of Semantic PDF Retrieval.
 *
 * Responsibility: turn a policy PDF into ordered pages of text lines, marking which
 * lines are headings. Nothing here knows about chunking, vectors or retrieval.
 *
 * The policy PDFs in `data/pdfs/` are produced by `scripts/generate-policy-pdfs.py`,
 * which emits minimal, uncompressed PDF 1.4 files using the built-in Helvetica fonts.
 * Because the content streams are plain text (no Flate compression, no embedded font
 * programs), a small, dependency-free parser can recover the text reliably. This keeps
 * the project free of a third-party PDF toolchain, exactly as the generator does. It is
 * NOT a general-purpose PDF parser; it understands only the subset our generator emits.
 */
import { readFileSync } from 'node:fs';

/** A single rendered line of text recovered from a PDF page. */
export interface PdfLine {
  text: string;
  /** True when the line was drawn in the bold font (F2), i.e. a heading. */
  isHeading: boolean;
}

/** One page of a PDF, in reading order. `page` is 1-based for human-readable citations. */
export interface PdfPage {
  page: number;
  lines: PdfLine[];
}

/** Undo the three escape sequences our generator emits: `\(`, `\)` and `\\`. */
function unescapePdfText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      out += raw[i + 1];
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Parse a single content stream into text lines. A line is a `(...) Tj` show-text
 * operator; the bold font is selected by a preceding `/F2 <size> Tf`, which marks the
 * line (and those after it, until the font changes) as a heading.
 */
function parseContentStream(stream: string): PdfLine[] {
  const lines: PdfLine[] = [];
  let isHeadingFont = false;

  for (const rawLine of stream.split('\n')) {
    const line = rawLine.trim();

    const fontMatch = line.match(/^\/(F\d+)\s+[\d.]+\s+Tf$/);
    if (fontMatch) {
      isHeadingFont = fontMatch[1] === 'F2';
      continue;
    }

    const textMatch = line.match(/^\((.*)\)\s*Tj$/);
    if (textMatch) {
      const text = unescapePdfText(textMatch[1]).trim();
      if (text) lines.push({ text, isHeading: isHeadingFont });
    }
    // All other operators (BT, ET, Tm positioning) are irrelevant to text recovery.
  }

  return lines;
}

/**
 * Extract the text of a generated policy PDF as ordered pages.
 *
 * The file is read as latin-1 so byte offsets line up with the PDF's single-byte
 * encoding. Objects are indexed by id, the `/Pages` tree gives page order via `/Kids`,
 * and each page's `/Contents` reference resolves to the content stream we parse.
 */
export function extractPdfPages(filePath: string): PdfPage[] {
  const raw = readFileSync(filePath, 'latin1');

  // Index every `N 0 obj ... endobj` body by object id.
  const objects = new Map<number, string>();
  const objectRegex = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  for (let m = objectRegex.exec(raw); m !== null; m = objectRegex.exec(raw)) {
    objects.set(Number(m[1]), m[2]);
  }

  // Find the page order from the /Pages node's /Kids array.
  let kids: number[] = [];
  for (const body of objects.values()) {
    if (/\/Type\s*\/Pages\b/.test(body)) {
      const kidsMatch = body.match(/\/Kids\s*\[([^\]]*)\]/);
      if (kidsMatch) {
        kids = [...kidsMatch[1].matchAll(/(\d+)\s+0\s+R/g)].map((k) => Number(k[1]));
      }
      break;
    }
  }

  const pages: PdfPage[] = [];
  kids.forEach((pageId, i) => {
    const pageBody = objects.get(pageId);
    if (!pageBody) return;

    const contentsMatch = pageBody.match(/\/Contents\s+(\d+)\s+0\s+R/);
    if (!contentsMatch) return;

    const contentBody = objects.get(Number(contentsMatch[1]));
    if (!contentBody) return;

    const streamMatch = contentBody.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (!streamMatch) return;

    pages.push({ page: i + 1, lines: parseContentStream(streamMatch[1]) });
  });

  return pages;
}
