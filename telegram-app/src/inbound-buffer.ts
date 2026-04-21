import type { Context } from "grammy";

export interface BufferedEntry {
  ctx: Context;
  text: string | null;
  attachments: { mimeType: string; data: string; filename: string }[];
}

type FlushHandler = (
  chatId: number,
  userId: number,
  text: string,
  attachments: { mimeType: string; data: string; filename: string }[],
  replyCtx: Context,
) => Promise<void>;

const DEBOUNCE_MS = 600;

const pending = new Map<
  number,
  { entries: BufferedEntry[]; timer: ReturnType<typeof setTimeout> }
>();

const busy = new Set<number>();

let flushHandler: FlushHandler | null = null;

export function clearBusy(chatId: number): void {
  busy.delete(chatId);
}

export function setFlushHandler(handler: FlushHandler): void {
  flushHandler = handler;
}

export function bufferMessage(entry: BufferedEntry): void {
  const chatId = entry.ctx.chat?.id;
  if (!chatId) return;

  if (busy.has(chatId)) {
    entry.ctx.reply("Still working on your previous request. Please wait.").catch(() => {});
    return;
  }

  const existing = pending.get(chatId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.entries.push(entry);
    existing.timer = setTimeout(() => flush(chatId), DEBOUNCE_MS);
  } else {
    const timer = setTimeout(() => flush(chatId), DEBOUNCE_MS);
    pending.set(chatId, { entries: [entry], timer });
  }
}

async function flush(chatId: number): Promise<void> {
  const bucket = pending.get(chatId);
  if (!bucket) return;
  pending.delete(chatId);

  const { entries } = bucket;
  if (entries.length === 0 || !flushHandler) return;

  const textParts: string[] = [];
  const attachments: { mimeType: string; data: string; filename: string }[] = [];

  for (const e of entries) {
    if (e.text) textParts.push(e.text);
    attachments.push(...e.attachments);
  }

  const combinedText =
    textParts.length > 0
      ? textParts.join("\n")
      : attachments.length > 0
        ? "Analyze these files"
        : "";

  const userId = entries[0].ctx.from?.id ?? 0;
  const lastCtx = entries[entries.length - 1].ctx;

  busy.add(chatId);
  try {
    await flushHandler(chatId, userId, combinedText, attachments, lastCtx);
  } finally {
    busy.delete(chatId);
  }
}
