import React, { memo, useMemo, useState, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { CodeBlock } from './CodeBlock';
import { ChartRenderer, ImageRenderer } from '../canvas';
import { CitationLink } from './CitationLink';
import { Loader2 } from 'lucide-react';

// S3 Image component that resolves presigned URLs
const S3Image = ({ src, alt }: { src: string; alt?: string }) => {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedSrcRef = React.useRef<string | null>(null);

  useEffect(() => {
    // Skip if already fetched this exact src
    if (lastFetchedSrcRef.current === src) return;

    // Reset state for new src
    setResolvedUrl(null);
    setLoading(true);
    setError(null);
    lastFetchedSrcRef.current = src;

    const fetchPresignedUrl = async () => {
      try {
        const response = await fetch('/api/s3/presigned-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ s3Key: src })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.details || errorData.error || 'Failed to get presigned URL');
        }

        const data = await response.json();
        setResolvedUrl(data.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load image');
      } finally {
        setLoading(false);
      }
    };

    fetchPresignedUrl();
  }, [src]);

  if (loading) {
    return (
      <span className="inline-flex items-center justify-center p-4 bg-muted/30 rounded-lg">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading image...</span>
      </span>
    );
  }

  if (error || !resolvedUrl) {
    return (
      <span className="inline-flex items-center justify-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
        {error || 'Image not available'}
      </span>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt || 'Research image'}
      className="max-w-full h-auto rounded-lg shadow-sm"
    />
  );
};

// Helper to strip <research> XML tags from content
const stripResearchTags = (content: string): string => {
  if (!content) return '';
  // Extract content from <research> tags if present
  const match = content.match(/<research>([\s\S]*?)<\/research>/);
  if (match && match[1]) {
    return match[1].trim();
  }
  // Remove any remaining <research> or </research> tags
  return content.replace(/<\/?research>/g, '');
};

// Helper function to extract domain from URL
const getDomain = (url: string): string => {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const components: Partial<Components> = {
  // Style links - show citation chips for external links
  a: ({ node, children, href, ...props }: any) => (
    <CitationLink href={href} {...props}>{children}</CitationLink>
  ),
  // Citation renderer - displays claim text with a clickable source chip
  cite: ({ node, children, ...props }: any) => {
    const source = props.source || '';
    const url = props.url || '';
    const domain = url ? getDomain(url) : '';

    return (
      <span className="citation-inline">
        {children}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 ml-1 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-600 dark:hover:text-blue-300 no-underline transition-colors align-middle"
            title={source || url}
          >
            <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span className="truncate max-w-[100px]">{domain}</span>
          </a>
        )}
      </span>
    );
  },
  // Handle images - resolve S3 presigned URLs
  img: ({ node, src, alt, ...props }: any) => {
    // Skip empty or invalid src
    if (!src) {
      return null;
    }
    // Check if this is an S3 URL
    if (src.startsWith('s3://')) {
      return <S3Image src={src} alt={alt} />;
    }
    // Regular image
    return <img src={src} alt={alt} className="max-w-full h-auto rounded-lg" {...props} />;
  },
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
          className="bg-zinc-100 dark:bg-zinc-800 py-0.5 px-1 rounded-md text-label"
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

// Custom URL transform to allow s3:// protocol (default only allows http, https, mailto, tel)
const customUrlTransform = (url: string): string => {
  // Allow s3:// URLs for images
  if (url.startsWith('s3://')) {
    return url;
  }
  // Allow standard protocols
  if (url.startsWith('http://') || url.startsWith('https://') ||
      url.startsWith('mailto:') || url.startsWith('tel:') ||
      url.startsWith('/') || url.startsWith('#') || url.startsWith('./')) {
    return url;
  }
  // Block other protocols for security
  return '';
};

// Chart code block pattern: ```chart\n{...}\n```
const CHART_CODE_BLOCK_PATTERN = /```chart\n([\s\S]*?)\n```/g;

// Chart reference pattern: [CHART:chart_name]
const CHART_REF_PATTERN = /\[CHART:([^\]]+)\]/g;

// Image pattern: [IMAGE:filename:alt_text]
const IMAGE_PATTERN = /\[IMAGE:([^:]+):([^\]]+)\]/g;

const parseContentWithCharts = (content: string) => {
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
  size?: 'sm' | 'base' | 'lg' | 'xl' | '2xl';
  preserveLineBreaks?: boolean;
  sessionId?: string;
  toolUseId?: string;
}) => {
  // Memoize parsing result to avoid re-parsing on every render
  const parts = useMemo(() => parseContentWithCharts(children), [children]);
  const remarkPlugins = useMemo(() => getRemarkPlugins(preserveLineBreaks), [preserveLineBreaks]);

  // Font size mapping (in pixels)
  const fontSizeMap: Record<string, string> = {
    'sm': '14px',
    'base': '15px',
    'lg': '16px',
    'xl': '18px',
    '2xl': '17px'
  };
  const fontSize = fontSizeMap[size] || '15px';

  const proseClass = `prose max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:mt-5 prose-headings:mb-2 prose-p:leading-relaxed prose-p:my-3 prose-li:py-1 prose-li:leading-relaxed prose-ul:my-3 prose-ol:my-3 prose-li:my-0 break-words min-w-0 ai-message-text`;

  return (
    <div className={proseClass} style={{ width: '100%', maxWidth: '100%', wordBreak: 'break-word', overflowWrap: 'anywhere', '--ai-font-size': fontSize } as React.CSSProperties}>
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
              urlTransform={customUrlTransform}
            >
              {stripResearchTags(part.content)}
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
