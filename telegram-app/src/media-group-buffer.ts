import type { Context } from "grammy";
import { downloadTelegramFile } from "./media-handler.js";
import { bufferMessage } from "./inbound-buffer.js";
import { logger } from "./config.js";

interface PhotoEntry {
  ctx: Context;
  fileId: string;
  caption: string | null;
  mimeType: string;
  filename: string;
}

const DEBOUNCE_MS = 800;

const groups = new Map<
  string,
  { entries: PhotoEntry[]; timer: ReturnType<typeof setTimeout> }
>();

export function bufferPhotoGroup(
  ctx: Context,
  mediaGroupId: string,
  fileId: string,
  caption: string | null,
  mimeType = "image/jpeg",
  filename = "photo.jpg",
): void {
  const entry: PhotoEntry = { ctx, fileId, caption, mimeType, filename };
  const existing = groups.get(mediaGroupId);

  if (existing) {
    clearTimeout(existing.timer);
    existing.entries.push(entry);
    existing.timer = setTimeout(() => flushGroup(mediaGroupId), DEBOUNCE_MS);
  } else {
    const timer = setTimeout(() => flushGroup(mediaGroupId), DEBOUNCE_MS);
    groups.set(mediaGroupId, { entries: [entry], timer });
  }
}

async function flushGroup(mediaGroupId: string): Promise<void> {
  const bucket = groups.get(mediaGroupId);
  if (!bucket) return;
  groups.delete(mediaGroupId);

  const { entries } = bucket;
  if (entries.length === 0) return;

  const lastCtx = entries[entries.length - 1].ctx;
  const captions = entries
    .map((e) => e.caption)
    .filter((c): c is string => !!c);
  const combinedCaption = captions.length > 0 ? captions.join("\n") : null;

  // Serial download — concurrent fetches against api.telegram.org cause ETIMEDOUT
  // when more than a few photos arrive at once.
  const attachments: { mimeType: string; data: string; filename: string }[] = [];
  let failures = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const fname = e.filename === "photo.jpg" ? `photo_${i + 1}.jpg` : e.filename;
    try {
      const media = await downloadTelegramFile(
        e.ctx.api,
        e.fileId,
        e.mimeType,
        fname,
      );
      attachments.push(media);
    } catch (err) {
      logger.error(
        { err, fileId: entries[i].fileId, mediaGroupId },
        "Failed to download grouped photo",
      );
      failures++;
    }
  }

  logger.info(
    { mediaGroupId, total: entries.length, ok: attachments.length, failures },
    "Media group flushed",
  );

  if (attachments.length > 0) {
    bufferMessage({ ctx: lastCtx, text: combinedCaption, attachments });
    if (failures > 0) {
      await lastCtx.api
        .sendMessage(
          lastCtx.chat!.id,
          `Couldn't download ${failures} of ${entries.length} photos; processing the rest.`,
        )
        .catch(() => {});
    }
    return;
  }

  await lastCtx.api
    .sendMessage(
      lastCtx.chat!.id,
      "Couldn't download the photos. Please try again.",
    )
    .catch(() => {});
}
