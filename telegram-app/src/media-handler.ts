import type { Api } from "grammy";
import { config, logger } from "./config.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB Telegram Bot API limit
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

export interface MediaFile {
  data: string;
  mimeType: string;
  filename: string;
}

function isTransient(err: unknown): boolean {
  // Match grammy HttpError wrapping a node-fetch FetchError, or a raw fetch error.
  const e = err as { code?: string; error?: { code?: string }; name?: string };
  const code = e?.code ?? e?.error?.code;
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    e?.name === "FetchError" ||
    e?.name === "HttpError"
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isTransient(err)) throw err;
      const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
      logger.warn({ label, attempt, delay }, "Transient telegram error; retrying");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  mimeType: string,
  filename: string,
): Promise<MediaFile> {
  const file = await withRetry("getFile", () => api.getFile(fileId));
  if (!file.file_path) {
    throw new Error("Telegram returned no file_path");
  }

  const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const resp = await withRetry("downloadFile", () => fetch(url));
  if (!resp.ok) {
    throw new Error(`File download failed: ${resp.status}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${buffer.length} bytes (max ${MAX_FILE_SIZE})`);
  }

  logger.debug({ fileId, size: buffer.length, mimeType }, "Downloaded file");

  return {
    data: buffer.toString("base64"),
    mimeType,
    filename,
  };
}

export function getLargestPhoto(
  photos: { file_id: string; width: number; height: number }[],
): string {
  return photos[photos.length - 1].file_id;
}
