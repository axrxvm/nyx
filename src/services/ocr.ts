import { appConfig } from "../config";

interface OcrPage {
  index?: number;
  markdown?: string;
}

interface OcrResponse {
  model?: string;
  pages?: OcrPage[];
}

type OcrAnnotationFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: Record<string, unknown> };

export interface OcrResult {
  model: string;
  text: string;
  pageCount: number;
}

interface OcrInput {
  url: string;
  contentType?: string | null;
  filename?: string | null;
  model?: string | null;
  id?: string;
  pages?: number[];
  includeImageBase64?: boolean;
  imageLimit?: number;
  imageMinSize?: number;
  tableFormat?: "markdown" | "html";
  extractHeader?: boolean;
  extractFooter?: boolean;
  documentAnnotationFormat?: OcrAnnotationFormat;
  bboxAnnotationFormat?: OcrAnnotationFormat;
}

type OcrDocumentType = "image_url" | "document_url";

const OCR_TIMEOUT_MS = 30_000;
const OCR_MODEL = "mistral-ocr-latest";

function looksLikeDocumentByName(value: string): boolean {
  return /\.(pdf|docx|pptx)(?:\?|$)/i.test(value);
}

function inferDocumentType(input: OcrInput): OcrDocumentType {
  const contentType = input.contentType?.toLowerCase() ?? "";
  if (contentType.startsWith("image/")) {
    return "image_url";
  }

  if (
    contentType.includes("pdf") ||
    contentType.includes("document") ||
    contentType.includes("officedocument") ||
    contentType.includes("presentation")
  ) {
    return "document_url";
  }

  const filename = input.filename?.trim() ?? "";
  if (filename && looksLikeDocumentByName(filename)) {
    return "document_url";
  }

  return looksLikeDocumentByName(input.url) ? "document_url" : "image_url";
}

function buildRequestBody(
  url: string,
  documentType: OcrDocumentType,
  input: OcrInput,
): Record<string, unknown> {
  const model = input.model?.trim() || OCR_MODEL;

  return {
    model,
    ...(input.id ? { id: input.id } : {}),
    ...(input.pages?.length ? { pages: input.pages } : {}),
    ...(typeof input.includeImageBase64 === "boolean"
      ? { include_image_base64: input.includeImageBase64 }
      : {}),
    ...(typeof input.imageLimit === "number" ? { image_limit: input.imageLimit } : {}),
    ...(typeof input.imageMinSize === "number" ? { image_min_size: input.imageMinSize } : {}),
    table_format: input.tableFormat ?? "markdown",
    ...(typeof input.extractHeader === "boolean" ? { extract_header: input.extractHeader } : {}),
    ...(typeof input.extractFooter === "boolean" ? { extract_footer: input.extractFooter } : {}),
    ...(input.documentAnnotationFormat
      ? { document_annotation_format: input.documentAnnotationFormat }
      : {}),
    ...(input.bboxAnnotationFormat
      ? { bbox_annotation_format: input.bboxAnnotationFormat }
      : {}),
    document:
      documentType === "document_url"
        ? {
            type: "document_url",
            document_url: url,
          }
        : {
            type: "image_url",
            image_url: url,
          },
  };
}

function normalizeExtractedText(response: OcrResponse): string {
  const text = (response.pages ?? [])
    .map((page) => page.markdown?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n---\n\n")
    .trim();

  if (text) {
    return text;
  }

  return "No text detected in the provided document.";
}

export async function runOcrFromUrl(url: string): Promise<OcrResult> {
  return runOcr({ url });
}

export async function runOcr(input: OcrInput): Promise<OcrResult> {
  const trimmed = input.url.trim();
  if (!trimmed) {
    throw new Error("OCR input URL is empty.");
  }

  const preferredType = inferDocumentType(input);
  const fallbackType: OcrDocumentType = preferredType === "image_url" ? "document_url" : "image_url";

  let response = await fetch(`${appConfig.aiBaseUrl}/ocr`, {
    method: "POST",
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appConfig.aiApiKey}`,
    },
    body: JSON.stringify(buildRequestBody(trimmed, preferredType, input)),
  });

  if (!response.ok && response.status >= 400 && response.status < 500) {
    response = await fetch(`${appConfig.aiBaseUrl}/ocr`, {
      method: "POST",
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appConfig.aiApiKey}`,
      },
      body: JSON.stringify(buildRequestBody(trimmed, fallbackType, input)),
    });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OCR request failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as OcrResponse;
  const text = normalizeExtractedText(payload);

  return {
    model: payload.model ?? "mistral-ocr-latest",
    text,
    pageCount: payload.pages?.length ?? 0,
  };
}
