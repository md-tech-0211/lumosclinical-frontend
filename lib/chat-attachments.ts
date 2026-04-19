/**
 * Shared rules for Luna chat file attachments (client + `/api/ai/monday`).
 * Types align with what Claude on Amazon Bedrock can consume via the AI SDK file parts.
 */

export const MAX_CHAT_ATTACHMENTS = 5;
export const MAX_CHAT_FILE_BYTES_CLIENT = 10 * 1024 * 1024;
export const MAX_CHAT_FILE_BYTES_SERVER = 12 * 1024 * 1024;

/**
 * Bedrock rejects a single PDF attachment over this many pages (per-document limit).
 */
export const BEDROCK_MAX_PDF_PAGES_PER_DOCUMENT = 100;

/**
 * Default max pages we send per PDF so **system prompt + tool definitions + PDF**
 * stay under Bedrock’s ~200k input-token cap. The per-document limit is 100, but
 * the total request must fit—dense PDFs need a lower cap.
 * Override with `MONDAY_CHAT_MAX_PDF_PAGES` (1–100).
 */
export const DEFAULT_MONDAY_CHAT_MAX_PDF_PAGES = 90;

/**
 * Effective page clamp for `/api/ai/monday` (server-only). Uses env when set.
 */
export function resolveMondayChatMaxPdfPages(): number {
  const raw = process.env.MONDAY_CHAT_MAX_PDF_PAGES?.trim();
  let n = DEFAULT_MONDAY_CHAT_MAX_PDF_PAGES;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      n = parsed;
    }
  }
  return Math.min(
    BEDROCK_MAX_PDF_PAGES_PER_DOCUMENT,
    Math.max(1, n)
  );
}

/**
 * Basis points applied to {@link resolveMondayChatMaxPdfPages} so **system + tools + PDF**
 * stay under the ~200k input limit (tool schemas and prompt text also count).
 * Default 9650 = 96.5%. Override with `MONDAY_CHAT_PDF_PAGE_HEADROOM_BPS` (1–10000).
 */
const DEFAULT_PDF_PAGE_HEADROOM_BPS = 9650;

/**
 * Final page count used when clamping PDFs for Bedrock. Applies headroom after env/base cap.
 */
export function effectiveMondayChatMaxPdfPages(): number {
  const resolved = resolveMondayChatMaxPdfPages();
  const raw = process.env.MONDAY_CHAT_PDF_PAGE_HEADROOM_BPS?.trim();
  let bps = DEFAULT_PDF_PAGE_HEADROOM_BPS;
  if (raw) {
    const p = Number.parseInt(raw, 10);
    if (Number.isFinite(p) && p >= 1 && p <= 10000) {
      bps = p;
    }
  }
  return Math.max(1, Math.floor((resolved * bps) / 10000));
}

const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Common Excel variants (often uploaded from Windows / Office with different MIME).
  ".xlsm": "application/vnd.ms-excel.sheet.macroenabled.12",
  ".xlsb": "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  ".xlt": "application/vnd.ms-excel",
  ".xltx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
};

const ALLOWED = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "application/csv",
]);

function normalizeClientMime(m: string): string {
  const t = m.trim().toLowerCase();
  if (t === "image/jpg") return "image/jpeg";
  if (t === "application/x-pdf") return "application/pdf";
  return t;
}

/**
 * Resolves a canonical MIME type for an upload, or `null` if the file is not allowed.
 * Handles empty/`application/octet-stream` using the file extension when possible.
 */
export function resolveChatAttachmentMime(
  fileName: string,
  fileType: string
): string | null {
  const name = fileName.trim();
  if (!name) return null;
  const lowerName = name.toLowerCase();
  const dot = lowerName.lastIndexOf(".");
  const ext = dot >= 0 ? lowerName.slice(dot) : "";
  const fromExt = ext ? EXT_TO_MIME[ext] : undefined;

  const rawType = fileType.trim();
  const t = rawType ? normalizeClientMime(rawType) : "";

  if (t && t !== "application/octet-stream") {
    if (ALLOWED.has(t)) return t;
  }

  if (
    (!t || t === "application/octet-stream") &&
    fromExt &&
    ALLOWED.has(fromExt)
  ) {
    return fromExt;
  }

  return null;
}

/** `accept` string for `<input type="file">` */
export const CHAT_ATTACHMENT_ACCEPT = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".xlsb",
  ".xlt",
  ".xltx",
  ".txt",
  ".md",
  ".html",
  ".htm",
  ".csv",
  "image/*",
  "application/pdf",
].join(",");

export const ATTACHMENT_TYPE_ERROR_HINT =
  "Supported: PDF, images (JPEG, PNG, GIF, WebP), Word, Excel, CSV, HTML, or plain text.";
