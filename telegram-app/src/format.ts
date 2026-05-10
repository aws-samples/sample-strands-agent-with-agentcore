const MAX_MESSAGE_LENGTH = 4096;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function convertCitations(text: string): string {
  // <cite source="Title" url="https://...">text</cite> → "text [Title](url)"
  // url is optional — LLMs sometimes omit it (skill prompt not strictly followed).
  // Attribute order is also flexible.
  return text.replace(
    /<cite\b([^>]*)>([\s\S]*?)<\/cite>/gi,
    (_match, attrs, body) => {
      const src = attrs.match(/\bsource="([^"]*)"/i)?.[1] ?? "";
      const url = attrs.match(/\burl="([^"]*)"/i)?.[1] ?? "";
      if (url && src) return `${body} [${src}](${url})`;
      if (url) return `${body} [${url}](${url})`;
      if (src) return `${body} (${src})`;
      return body;
    },
  );
}

export function markdownToTelegramHtml(text: string): string {
  text = convertCitations(text);
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    if (!inCodeBlock && line.match(/^```(\w*)/)) {
      inCodeBlock = true;
      codeBlockLang = line.slice(3).trim();
      codeBlockLines = [];
      continue;
    }

    if (inCodeBlock) {
      if (line.startsWith("```")) {
        const langAttr = codeBlockLang
          ? ` class="language-${escapeHtml(codeBlockLang)}"`
          : "";
        result.push(
          `<pre><code${langAttr}>${escapeHtml(codeBlockLines.join("\n"))}</code></pre>`,
        );
        inCodeBlock = false;
        codeBlockLang = "";
        codeBlockLines = [];
      } else {
        codeBlockLines.push(line);
      }
      continue;
    }

    result.push(convertInlineMarkdown(line));
  }

  if (inCodeBlock) {
    const langAttr = codeBlockLang
      ? ` class="language-${escapeHtml(codeBlockLang)}"`
      : "";
    result.push(
      `<pre><code${langAttr}>${escapeHtml(codeBlockLines.join("\n"))}</code></pre>`,
    );
  }

  return result.join("\n");
}

function convertInlineMarkdown(line: string): string {
  // Headings → bold
  const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
  if (headingMatch) {
    return `<b>${convertInlineFormatting(escapeHtml(headingMatch[1]))}</b>`;
  }

  // Blockquote
  if (line.startsWith("> ")) {
    return `<blockquote>${convertInlineFormatting(escapeHtml(line.slice(2)))}</blockquote>`;
  }

  return convertInlineFormatting(escapeHtml(line));
}

function convertInlineFormatting(text: string): string {
  // Inline code (must come before bold/italic to avoid conflicts)
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* or _text_ (not inside code tags)
  text = text.replace(/(?<![<\w])\*([^*]+)\*(?![>\w])/g, "<i>$1</i>");
  text = text.replace(/(?<![<\w])_([^_]+)_(?![>\w])/g, "<i>$1</i>");

  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url)
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  return text;
}

export function splitTelegramHtml(
  html: string,
  maxLen: number = MAX_MESSAGE_LENGTH,
): string[] {
  if (html.length <= maxLen) return [html];

  const chunks: string[] = [];
  let remaining = html;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = findSafeSplitIndex(remaining, maxLen);
    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}

function findSafeSplitIndex(text: string, maxLen: number): number {
  // Try splitting at last newline
  const lastNewline = text.lastIndexOf("\n", maxLen);
  if (lastNewline > maxLen * 0.3) return lastNewline + 1;

  // Try splitting at last space
  const lastSpace = text.lastIndexOf(" ", maxLen);
  if (lastSpace > maxLen * 0.3) return lastSpace + 1;

  // Avoid splitting inside HTML entities (&amp; &lt; &gt;)
  let idx = maxLen;
  const ampIdx = text.lastIndexOf("&", idx);
  if (ampIdx >= 0 && ampIdx > idx - 6) {
    const semiIdx = text.indexOf(";", ampIdx);
    if (semiIdx >= 0 && semiIdx <= ampIdx + 6) {
      idx = ampIdx;
    }
  }

  // Avoid splitting inside HTML tags
  const ltIdx = text.lastIndexOf("<", idx);
  if (ltIdx >= 0 && ltIdx > idx - 50) {
    const gtIdx = text.indexOf(">", ltIdx);
    if (gtIdx >= 0 && gtIdx >= idx) {
      idx = ltIdx;
    }
  }

  return idx;
}
