/**
 * Chunking — turn extracted PDF pages into retrievable passages.
 *
 * Responsibility: group recovered text lines into coherent passages so each retrieval
 * hit is a meaningful, citable unit. The policy PDFs are well structured around headings,
 * so we chunk by heading: a passage is a heading plus the body lines beneath it, up to the
 * next heading. The passage is cited by the page on which its heading begins.
 *
 * This keeps passages semantically self-contained (a section is about one topic) and gives
 * a natural, human-checkable citation. Splitting oversized sections is deliberately left
 * out: the policy sections are short, and a simpler chunker is easier to reason about.
 */
import { basename } from 'node:path';
import type { PdfPage } from './pdf-text';

/** A passage ready to be embedded and retrieved. */
export interface PolicyChunk {
  /** Citable reference, e.g. `billing-policy.pdf#p2`. */
  ref: string;
  /** Stable document id derived from the file name, e.g. `billing-policy`. */
  slug: string;
  /** Original PDF file name, e.g. `Billing Policy.pdf`. */
  file: string;
  /** 1-based page on which the passage's heading appears. */
  page: number;
  /** The heading line that opens the passage. */
  heading: string;
  /** The full passage text (heading followed by its body), used for embedding and grounding. */
  text: string;
}

/** Derive a stable, citable slug from a PDF file name: `Billing Policy.pdf` -> `billing-policy`. */
export function slugForFile(file: string): string {
  return basename(file, '.pdf').trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Split a document's pages into heading-delimited passages.
 *
 * Body lines that appear before the first heading (none in our generated PDFs, where the
 * title is the first heading) are attached to an untitled leading passage so no text is
 * silently dropped.
 */
export function chunkPages(file: string, pages: PdfPage[]): PolicyChunk[] {
  const slug = slugForFile(file);
  const chunks: PolicyChunk[] = [];

  let heading = '';
  let body: string[] = [];
  let page = 1;
  let started = false;

  const flush = () => {
    if (!started) return;
    const text = [heading, body.join(' ')].filter(Boolean).join(' ').trim();
    if (text) {
      chunks.push({ ref: `${slug}.pdf#p${page}`, slug, file, page, heading, text });
    }
  };

  for (const pdfPage of pages) {
    for (const line of pdfPage.lines) {
      if (line.isHeading) {
        flush();
        heading = line.text;
        body = [];
        page = pdfPage.page;
        started = true;
      } else {
        if (!started) {
          // Body before any heading: open an untitled passage on this page.
          started = true;
          page = pdfPage.page;
        }
        body.push(line.text);
      }
    }
  }
  flush();

  return chunks;
}
