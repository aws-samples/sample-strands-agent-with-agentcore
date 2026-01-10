import React, { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { CodeBlock } from './CodeBlock';
import { ChartRenderer } from '../ChartRenderer';
import { ImageRenderer } from '../ImageRenderer';

const components: Partial<Components> = {
  code: ({ node, className, children, ...props }: any) => {
    // Check if this is a code block by looking for language class
    // Code blocks typically have className like "language-javascript"
    const isCodeBlock = className && className.startsWith('language-');

    if (isCodeBlock) {
      // This is a code block
      return (
        <CodeBlock
          node={node}
          inline={false}
          className={className}
          {...props}
        >
          {children}
        </CodeBlock>
      );
    } else {
      // This is inline code - remove any remaining backticks
      const cleanChildren = String(children).replace(/^`+|`+$/g, '');
      return (
        <code
          className="bg-zinc-100 dark:bg-zinc-800 py-0.5 px-1 rounded-md text-sm"
          {...props}
        >
          {cleanChildren}
        </code>
      );
    }
  },
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-4" style={{ width: '100%', maxWidth: '100%', display: 'block' }}>
      <table className="border-collapse" style={{ width: 'auto', minWidth: 'max-content' }}>
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 bg-gray-100 dark:bg-gray-800 whitespace-pre-wrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-300 dark:border-gray-600 px-4 py-2 whitespace-pre-wrap">
      {children}
    </td>
  ),
};

const getRemarkPlugins = (preserveLineBreaks?: boolean) => {
  const plugins = [remarkGfm];
  if (preserveLineBreaks) {
    plugins.push(remarkBreaks as any);
  }
  return plugins;
};

// Chart code block pattern: ```chart\n{...}\n```
const CHART_CODE_BLOCK_PATTERN = /```chart\n([\s\S]*?)\n```/g;

// Chart reference pattern: [CHART:chart_name]
const CHART_REF_PATTERN = /\[CHART:([^\]]+)\]/g;

// Image pattern: [IMAGE:filename:alt_text]
const IMAGE_PATTERN = /\[IMAGE:([^:]+):([^\]]+)\]/g;

/**
 * Process incomplete cite tags during streaming.
 * Instead of hiding them, we close incomplete tags so they render as chips immediately.
 * Links become active once the tag is complete with url attribute.
 *
 * Performance optimized: uses indexOf for fast early return when no citations present.
 */
const processIncompleteCiteTags = (content: string): string => {
  // Fast early return: indexOf is faster than lastIndexOf for checking existence
  // Most streaming chunks don't contain citations, so this is the common path
  const firstCiteIndex = content.indexOf('<cite');
  if (firstCiteIndex === -1) {
    return content;
  }

  // Only use lastIndexOf when we know citations exist
  const lastCiteOpen = content.lastIndexOf('<cite');
  const lastCiteClose = content.lastIndexOf('</cite>');

  // If closing tag exists and comes after opening tag, content is complete
  if (lastCiteClose > lastCiteOpen) {
    return content;
  }

  // There's an incomplete cite tag - check if we have the opening > yet
  const tagContent = content.slice(lastCiteOpen);
  const hasOpeningComplete = tagContent.includes('>');

  if (!hasOpeningComplete) {
    // Tag attributes still being typed (e.g., "<cite source="Wiki)
    // Truncate to hide the incomplete tag
    return content.slice(0, lastCiteOpen);
  }

  // Tag opening is complete but no closing tag yet
  // Close it so the partial content renders as a chip
  return content + '</cite>';
};

const parseContentWithCharts = (rawContent: string) => {
  // Process incomplete cite tags - close them so they render as chips during streaming
  const content = processIncompleteCiteTags(rawContent);
  const parts: Array<{ type: 'text' | 'chart' | 'chartRef' | 'image'; content: string; chartData?: any; chartName?: string; imageId?: string; altText?: string }> = [];
  const patterns = [
    { regex: CHART_CODE_BLOCK_PATTERN, type: 'chart' as const },
    { regex: CHART_REF_PATTERN, type: 'chartRef' as const },
    { regex: IMAGE_PATTERN, type: 'image' as const }
  ];
  
  // Find all matches from all patterns
  const allMatches: Array<{ match: RegExpExecArray; type: 'chart' | 'chartRef' | 'image' }> = [];
  
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0; // Reset regex
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      allMatches.push({ match, type: pattern.type });
    }
  }
  
  // Sort matches by position
  allMatches.sort((a, b) => a.match.index - b.match.index);
  
  let lastIndex = 0;
  
  for (const { match, type } of allMatches) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index);
      if (textContent) {
        parts.push({ type: 'text', content: textContent });
      }
    }

    // Add chart, chartRef, or image
    if (type === 'chart') {
      try {
        // Parse the JSON chart data
        const chartData = JSON.parse(match[1]);
        parts.push({
          type: 'chart',
          content: match[0],
          chartData: chartData
        });
      } catch (error) {
        console.error('Failed to parse chart JSON:', error);
        // If parsing fails, treat as regular text
        parts.push({ type: 'text', content: match[0] });
      }
    } else if (type === 'chartRef') {
      parts.push({
        type: 'chartRef',
        content: match[0],
        chartName: match[1]
      });
    } else if (type === 'image') {
      parts.push({
        type: 'image',
        content: match[0],
        imageId: match[1],
        altText: match[2]
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    const remainingContent = content.slice(lastIndex);
    if (remainingContent) {
      parts.push({ type: 'text', content: remainingContent });
    }
  }

  // If no matches found, return original content as text
  if (parts.length === 0) {
    parts.push({ type: 'text', content });
  }

  return parts;
};

const NonMemoizedMarkdown = ({
  children,
  size = 'sm',
  preserveLineBreaks = false,
  sessionId,
  toolUseId
}: {
  children: string;
  size?: 'sm' | 'base' | 'lg' | 'xl';
  preserveLineBreaks?: boolean;
  sessionId?: string;
  toolUseId?: string;
}) => {
  // Memoize parsing result to avoid re-parsing on every render
  const parts = useMemo(() => parseContentWithCharts(children), [children]);
  const remarkPlugins = useMemo(() => getRemarkPlugins(preserveLineBreaks), [preserveLineBreaks]);

  const proseClass = `prose prose-${size} max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-1.5 prose-p:leading-relaxed prose-p:text-base prose-li:py-0.5 prose-li:text-base prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-ul:text-base prose-ol:text-base break-words min-w-0`;

  return (
    <div className={proseClass} style={{ width: '100%', maxWidth: '100%', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
      {parts.map((part, index) => {
        if (part.type === 'chart' && part.chartData) {
          return (
            <div key={index} className="my-6 not-prose">
              <ChartRenderer chartData={part.chartData} />
            </div>
          );
        } else if (part.type === 'image' && part.imageId) {
          return (
            <div key={index} className="my-6 not-prose">
              <ImageRenderer 
                imageId={part.imageId} 
                altText={part.altText}
                sessionId={sessionId}
                toolUseId={toolUseId}
              />
            </div>
          );
        } else {
          return (
            <ReactMarkdown
              key={index}
              remarkPlugins={remarkPlugins}
              rehypePlugins={[rehypeRaw]}
              components={components}
            >
              {part.content}
            </ReactMarkdown>
          );
        }
      })}
    </div>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => 
    prevProps.children === nextProps.children && 
    prevProps.size === nextProps.size &&
    prevProps.preserveLineBreaks === nextProps.preserveLineBreaks,
);
