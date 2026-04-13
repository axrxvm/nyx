import type { Attachment } from "discord.js";

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|avif|svg)(?:\?|$)/i;
const PDF_EXTENSION_PATTERN = /\.pdf(?:\?|$)/i;

type AttachmentLike = Pick<Attachment, "url" | "name" | "contentType">;

export function isLikelyImageUrl(url: string): boolean {
  const value = url.trim();
  if (!value) {
    return false;
  }

  if (value.startsWith("data:image/")) {
    return true;
  }

  return IMAGE_EXTENSION_PATTERN.test(value);
}

export function attachmentIsImage(attachment: AttachmentLike): boolean {
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  if (contentType.startsWith("image/")) {
    return true;
  }

  if (attachment.name && IMAGE_EXTENSION_PATTERN.test(attachment.name)) {
    return true;
  }

  return isLikelyImageUrl(attachment.url);
}

export function collectImageAttachmentUrls(attachments: Iterable<AttachmentLike>): string[] {
  return [...new Set(
    [...attachments]
      .filter((attachment) => attachmentIsImage(attachment))
      .map((attachment) => attachment.url)
      .filter(Boolean),
  )];
}

export function attachmentIsPdf(attachment: AttachmentLike): boolean {
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  if (contentType.includes("application/pdf")) {
    return true;
  }

  if (attachment.name && PDF_EXTENSION_PATTERN.test(attachment.name)) {
    return true;
  }

  return PDF_EXTENSION_PATTERN.test(attachment.url);
}
