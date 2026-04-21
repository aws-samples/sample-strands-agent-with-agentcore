import type { Api } from "grammy";
import { config, logger } from "./config.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB Telegram Bot API limit

export interface MediaFile {
  data: string;
  mimeType: string;
  filename: string;
}

export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  mimeType: string,
  filename: string,
): Promise<MediaFile> {
  const file = await api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram returned no file_path");
  }

  const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const resp = await fetch(url);
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
