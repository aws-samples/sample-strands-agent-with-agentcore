import { InputFile, InlineKeyboard, type Api } from "grammy";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { marked } from "marked";
import type { AgentResponse } from "./agentcore-client.js";
import { markdownToTelegramHtml, splitTelegramHtml } from "./format.js";
import { config, logger } from "./config.js";

const s3 = new S3Client({});

const PHOTO_MAX_SIZE = 10 * 1024 * 1024;

export async function sendAgentResponse(
  api: Api,
  chatId: number,
  response: AgentResponse,
): Promise<void> {
  if (response.error && !response.text) {
    await api.sendMessage(chatId, "Something went wrong. Please try again or use /reset to start a new session.");
    return;
  }

  if (response.text) {
    await sendTextResponse(api, chatId, response.text);
  }

  for (const img of response.images) {
    try {
      const buf = Buffer.from(img.data, "base64");
      const ext = img.format === "jpeg" ? "jpg" : img.format || "png";
      const file = new InputFile(buf, `image.${ext}`);

      if (buf.length > PHOTO_MAX_SIZE) {
        await api.sendDocument(chatId, file, { caption: img.title });
      } else {
        await api.sendPhoto(chatId, file, { caption: img.title });
      }
    } catch (err) {
      logger.error({ err }, "Failed to send image");
    }
  }

  for (const file of response.files) {
    try {
      let buf: Buffer;
      if (file.s3Url) {
        buf = await downloadFromS3(file.s3Url);
      } else {
        buf = Buffer.from(file.data, "base64");
      }
      await api.sendDocument(chatId, new InputFile(buf, file.filename));
    } catch (err) {
      logger.error({ err, filename: file.filename }, "Failed to send file");
    }
  }

  for (const loc of response.locations) {
    try {
      const label = loc.label ? `${loc.label}: ` : "";
      const url = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
      await api.sendMessage(chatId, `${label}${url}`);
    } catch (err) {
      logger.error({ err }, "Failed to send location");
    }
  }

  for (const artifact of response.artifacts) {
    try {
      await sendArtifactAsHtml(api, chatId, artifact);
    } catch (err) {
      logger.error({ err }, "Failed to send artifact");
    }
  }

  if (response.interrupt) {
    await sendInterruptPrompt(api, chatId, response.interrupt);
  }
}

const pendingInterrupts = new Map<number, string>();

export function getPendingInterruptId(chatId: number): string | undefined {
  return pendingInterrupts.get(chatId);
}

export function clearPendingInterrupt(chatId: number): void {
  pendingInterrupts.delete(chatId);
}

async function sendInterruptPrompt(
  api: Api,
  chatId: number,
  interrupt: NonNullable<AgentResponse["interrupt"]>,
): Promise<void> {
  const reason = interrupt.reason;
  let description = "";
  if (reason?.plan) {
    const plan = String(reason.plan);
    description = plan.length > 500 ? plan.slice(0, 500) + "..." : plan;
  } else if (reason?.task) {
    description = String(reason.task);
  }

  const text = description
    ? `<b>Approval required</b>\n\n<pre>${escapeHtml(description)}</pre>`
    : "<b>Approval required</b>";

  pendingInterrupts.set(chatId, interrupt.id);
  logger.info({ interruptId: interrupt.id, name: interrupt.name }, "Sending interrupt prompt");

  const keyboard = new InlineKeyboard()
    .text("Approve", "int:y")
    .text("Decline", "int:n");

  await api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const S3_IMAGE_RE = /!\[([^\]]*)\]\((s3:\/\/[^)]+)\)\n?\*?(?:Figure:\s*[^*]*)?\*?/g;

async function sendTextResponse(
  api: Api,
  chatId: number,
  text: string,
): Promise<void> {
  if (!S3_IMAGE_RE.test(text)) {
    await sendHtmlChunks(api, chatId, text);
    return;
  }

  S3_IMAGE_RE.lastIndex = 0;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = S3_IMAGE_RE.exec(text)) !== null) {
    const before = text.slice(lastIdx, match.index).trim();
    if (before) {
      await sendHtmlChunks(api, chatId, before);
    }

    const alt = match[1] || "Chart";
    const s3Url = match[2];
    try {
      const buf = await downloadFromS3(s3Url);
      const file = new InputFile(buf, `${alt.replace(/[^\w\s-]/g, "").slice(0, 40)}.png`);
      if (buf.length > PHOTO_MAX_SIZE) {
        await api.sendDocument(chatId, file, { caption: alt });
      } else {
        await api.sendPhoto(chatId, file, { caption: alt });
      }
    } catch (err) {
      logger.error({ err, s3Url }, "Failed to send inline S3 image");
    }

    lastIdx = match.index + match[0].length;
  }

  const remaining = text.slice(lastIdx).trim();
  if (remaining) {
    await sendHtmlChunks(api, chatId, remaining);
  }
}

async function sendHtmlChunks(
  api: Api,
  chatId: number,
  text: string,
): Promise<void> {
  const html = markdownToTelegramHtml(text);
  const chunks = splitTelegramHtml(html);

  for (const chunk of chunks) {
    try {
      await api.sendMessage(chatId, chunk, { parse_mode: "HTML" });
    } catch {
      const plainChunks = splitTelegramHtml(text);
      for (const plain of plainChunks) {
        await api.sendMessage(chatId, plain).catch(() => {});
      }
      return;
    }
  }
}

async function sendArtifactAsHtml(
  api: Api,
  chatId: number,
  markdown: string,
): Promise<void> {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "Report";
  const filename = `${title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 50)}.html`;

  // Resolve S3 image references to inline base64 before markdown conversion
  let resolved = markdown;
  const s3ImgRe = /!\[([^\]]*)\]\((s3:\/\/[^)]+)\)/g;
  const replacements: [string, string][] = [];
  let match: RegExpExecArray | null;
  while ((match = s3ImgRe.exec(markdown)) !== null) {
    try {
      const buf = await downloadFromS3(match[2]);
      replacements.push([match[2], `data:image/png;base64,${buf.toString("base64")}`]);
    } catch {
      // leave original URL
    }
  }
  for (const [from, to] of replacements) {
    resolved = resolved.replaceAll(from, to);
  }

  const body = await marked.parse(resolved);

  const styledHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
  pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  code { background: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; height: auto; border-radius: 6px; margin: 1rem 0; }
  blockquote { border-left: 3px solid #ddd; margin: 1rem 0; padding: 0.5rem 1rem; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
  th { background: #f5f5f5; }
  h1 { border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
  h2 { margin-top: 2rem; }
  a { color: #0066cc; }
</style>
</head><body>
${body}
</body></html>`;

  const buf = Buffer.from(styledHtml, "utf-8");
  await api.sendDocument(chatId, new InputFile(buf, filename), {
    caption: title,
  });
}

async function downloadFromS3(s3Url: string): Promise<Buffer> {
  const url = new URL(s3Url);
  let bucket: string;
  let key: string;

  if (url.protocol === "s3:") {
    bucket = url.hostname;
    key = url.pathname.slice(1);
  } else {
    bucket = config.artifactBucket;
    key = s3Url;
  }

  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await resp.Body!.transformToByteArray();
  return Buffer.from(bytes);
}
