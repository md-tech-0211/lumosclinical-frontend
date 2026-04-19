import { Buffer } from "node:buffer";
import { EncryptedPDFError, PDFDocument, ParseSpeeds } from "pdf-lib";

const baseLoadOptions = {
  updateMetadata: false,
  throwOnInvalidObject: false,
} as const;

/**
 * Load with progressively more lenient options (some real-world PDFs have xref quirks
 * but still open in viewers and work with Bedrock).
 */
async function loadPdfDocument(buf: Buffer): Promise<PDFDocument> {
  const variants: Array<NonNullable<Parameters<typeof PDFDocument.load>[1]>> = [
    { ...baseLoadOptions, ignoreEncryption: false, parseSpeed: ParseSpeeds.Fast },
    { ...baseLoadOptions, ignoreEncryption: true, parseSpeed: ParseSpeeds.Fast },
    { ...baseLoadOptions, ignoreEncryption: true, parseSpeed: ParseSpeeds.Fastest },
  ];

  let last: unknown;
  for (const opts of variants) {
    try {
      return await PDFDocument.load(buf, opts);
    } catch (e) {
      last = e;
      if (e instanceof EncryptedPDFError && opts.ignoreEncryption === false) {
        continue;
      }
    }
  }

  throw last instanceof Error ? last : new Error(String(last));
}

/** Negative = could not parse locally (caller may still send bytes to Bedrock). */
export const PDF_PAGE_COUNT_UNKNOWN = -1;

/**
 * Returns the number of pages in a PDF buffer, or throws if the file cannot be parsed.
 */
export async function getPdfPageCount(buf: Buffer): Promise<number> {
  const doc = await loadPdfDocument(buf);
  try {
    return doc.getPageCount();
  } catch {
    throw new Error("PDF loaded but page count could not be determined (damaged catalog or refs).");
  }
}

export type ClampPdfResult = {
  buffer: Buffer;
  /** Set to {@link PDF_PAGE_COUNT_UNKNOWN} when we could not parse (original buffer returned). */
  pageCount: number;
  truncated: boolean;
};

/**
 * If the PDF has more than `maxPages` pages, returns a new PDF with only the first
 * `maxPages` pages (Bedrock document limit). Otherwise returns the original bytes.
 * If parsing fails, returns the **original buffer** unchanged (Bedrock may still accept it).
 */
export async function clampPdfToMaxPages(
  buf: Buffer,
  maxPages: number
): Promise<ClampPdfResult> {
  let src: PDFDocument;
  try {
    src = await loadPdfDocument(buf);
  } catch {
    console.warn(
      "[pdf] Page trim skipped: pdf-lib could not load this file. Sending original bytes."
    );
    return {
      buffer: buf,
      pageCount: PDF_PAGE_COUNT_UNKNOWN,
      truncated: false,
    };
  }

  // Load can succeed while the page tree is still broken (lazy getPageCount / copyPages).
  try {
    const pageCount = src.getPageCount();
    if (pageCount <= maxPages) {
      return { buffer: buf, pageCount, truncated: false };
    }

    const out = await PDFDocument.create();
    const indices = Array.from({ length: maxPages }, (_, i) => i);
    const copied = await out.copyPages(src, indices);
    for (const p of copied) {
      out.addPage(p);
    }
    const bytes = await out.save();
    return {
      buffer: Buffer.from(bytes),
      pageCount,
      truncated: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[pdf] Page trim skipped (page tree/export failed: ${msg}). Sending original bytes.`
    );
    return {
      buffer: buf,
      pageCount: PDF_PAGE_COUNT_UNKNOWN,
      truncated: false,
    };
  }
}
