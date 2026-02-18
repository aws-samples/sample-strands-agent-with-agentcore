#!/usr/bin/env python3
"""
Web Search Skill - Combined DuckDuckGo Search and URL Fetching
Provides CLI interface for web search and content extraction
"""

import argparse
import asyncio
import json
import logging
import sys
from typing import Optional, Dict, List, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def extract_text_from_html(html: str, max_length: int = 50000) -> str:
    """Extract clean text from HTML content"""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, 'html.parser')

        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.decompose()

        # Get text
        text = soup.get_text()

        # Clean up whitespace
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = '\n'.join(chunk for chunk in chunks if chunk)

        # Limit length
        if len(text) > max_length:
            text = text[:max_length] + "\n\n[Content truncated...]"

        return text

    except ImportError:
        logger.warning("BeautifulSoup not available, using basic text extraction")
        # If BeautifulSoup not available, return raw text with basic cleanup
        import re
        # Remove HTML tags
        text = re.sub(r'<[^>]+>', '', html)
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        if len(text) > max_length:
            text = text[:max_length] + "\n\n[Content truncated...]"

        return text


async def fetch_url_content(
    url: str,
    include_html: bool = False,
    max_length: int = 50000
) -> Dict[str, Any]:
    """
    Fetch and extract text content from a web page URL.

    Args:
        url: The URL to fetch (must start with http:// or https://)
        include_html: If True, includes raw HTML in response
        max_length: Maximum character length of extracted text

    Returns:
        Dictionary with extracted content or error information
    """
    try:
        import httpx

        # Validate URL
        if not url.startswith(('http://', 'https://')):
            return {
                "success": False,
                "error": "URL must start with http:// or https://",
                "url": url
            }

        # Fetch URL with timeout
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            headers = {
                "User-Agent": "Mozilla/5.0 (compatible; WebSearchSkill/1.0)"
            }

            response = await client.get(url, headers=headers)
            response.raise_for_status()

            # Get content
            html_content = response.text
            content_type = response.headers.get('content-type', '')

            # Extract title
            title = "No title"
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html_content, 'html.parser')
                title_tag = soup.find('title')
                if title_tag:
                    title = title_tag.get_text().strip()
            except:
                pass

            # Extract text
            text_content = extract_text_from_html(html_content, max_length)

            # Build response
            result = {
                "success": True,
                "url": url,
                "title": title,
                "content_type": content_type,
                "text_content": text_content,
                "text_length": len(text_content),
                "status_code": response.status_code
            }

            if include_html:
                result["html_content"] = html_content[:max_length]

            logger.info(f"Successfully fetched content from: {url} ({len(text_content)} chars)")

            return result

    except Exception as e:
        error_type = type(e).__name__
        logger.error(f"Error fetching URL {url}: {error_type} - {e}")

        # Handle specific error types
        if "httpx" in str(type(e).__module__):
            import httpx
            if isinstance(e, httpx.HTTPStatusError):
                return {
                    "success": False,
                    "error": f"HTTP error {e.response.status_code}: {e.response.reason_phrase}",
                    "url": url,
                    "status_code": e.response.status_code
                }
            elif isinstance(e, httpx.TimeoutException):
                return {
                    "success": False,
                    "error": "Request timed out (30 seconds)",
                    "url": url
                }

        return {
            "success": False,
            "error": f"{error_type}: {str(e)}",
            "url": url
        }


def ddg_web_search(query: str, max_results: int = 5) -> Dict[str, Any]:
    """
    Search the web using DuckDuckGo.

    Args:
        query: Search query string
        max_results: Maximum number of results to return (max: 10)

    Returns:
        Dictionary with search results or error information
    """
    try:
        # Import ddgs here to provide better error message if not installed
        from ddgs import DDGS

        # Limit max_results to prevent abuse
        max_results = min(max_results, 10)

        # Perform search
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))

        # Format results
        formatted_results = []
        for idx, result in enumerate(results):
            formatted_results.append({
                "index": idx + 1,
                "title": result.get("title", "No title"),
                "snippet": result.get("body", "No snippet"),
                "link": result.get("href", "No link")
            })

        logger.info(f"Web search completed: {len(formatted_results)} results for '{query}'")

        return {
            "success": True,
            "query": query,
            "result_count": len(formatted_results),
            "results": formatted_results
        }

    except ImportError:
        error_msg = "ddgs library not installed. Please install it with: pip install ddgs"
        logger.error(error_msg)
        return {
            "success": False,
            "error": error_msg,
            "query": query
        }

    except Exception as e:
        logger.error(f"Error performing web search: {e}")
        return {
            "success": False,
            "error": str(e),
            "query": query
        }


async def search_and_fetch(
    query: str,
    max_results: int = 5,
    top_n: int = 3,
    max_length: int = 50000
) -> Dict[str, Any]:
    """
    Perform web search and fetch content from top N results.

    Args:
        query: Search query string
        max_results: Maximum number of search results
        top_n: Number of top results to fetch content from
        max_length: Maximum character length for each fetched page

    Returns:
        Dictionary with search results and fetched content
    """
    # First, perform the search
    search_results = ddg_web_search(query, max_results)

    if not search_results.get("success"):
        return search_results

    # Get URLs from top N results
    results = search_results.get("results", [])
    urls_to_fetch = [r["link"] for r in results[:top_n]]

    # Fetch content from each URL
    fetched_content = []
    for idx, url in enumerate(urls_to_fetch, 1):
        logger.info(f"Fetching content from result {idx}/{len(urls_to_fetch)}: {url}")
        content = await fetch_url_content(url, max_length=max_length)

        fetched_content.append({
            "index": idx,
            "url": url,
            "title": content.get("title", "No title"),
            "text_content": content.get("text_content", ""),
            "text_length": content.get("text_length", 0),
            "fetch_success": content.get("success", False),
            "error": content.get("error")
        })

    return {
        "success": True,
        "query": query,
        "search_results": search_results,
        "fetched_content": fetched_content,
        "total_results": len(results),
        "fetched_count": len(fetched_content)
    }


def main():
    """Main CLI entry point"""
    parser = argparse.ArgumentParser(
        description='Web Search Skill - Search the web and fetch content from URLs',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Search the web
  %(prog)s --query "Python async programming"

  # Fetch content from URL
  %(prog)s --fetch-url "https://example.com/article"

  # Search and auto-fetch top results
  %(prog)s --query "AWS Lambda" --fetch-content --top-n 3
        """
    )

    # Search options
    parser.add_argument(
        '--query', '-q',
        type=str,
        help='Search query string'
    )
    parser.add_argument(
        '--max-results', '-m',
        type=int,
        default=5,
        help='Maximum number of search results (default: 5, max: 10)'
    )

    # Fetch options
    parser.add_argument(
        '--fetch-url', '-u',
        type=str,
        help='URL to fetch content from'
    )
    parser.add_argument(
        '--include-html',
        action='store_true',
        help='Include raw HTML in response'
    )
    parser.add_argument(
        '--max-length', '-l',
        type=int,
        default=50000,
        help='Maximum character length for fetched content (default: 50000)'
    )

    # Combined mode
    parser.add_argument(
        '--fetch-content', '-f',
        action='store_true',
        help='Automatically fetch content from top search results'
    )
    parser.add_argument(
        '--top-n', '-n',
        type=int,
        default=3,
        help='Number of top results to fetch content from (default: 3)'
    )

    # Output options
    parser.add_argument(
        '--pretty',
        action='store_true',
        help='Pretty-print JSON output'
    )

    args = parser.parse_args()

    # Validate arguments
    if not args.query and not args.fetch_url:
        parser.error("Must specify either --query or --fetch-url")

    if args.query and args.fetch_url:
        parser.error("Cannot specify both --query and --fetch-url")

    # Execute appropriate mode
    try:
        if args.fetch_url:
            # URL fetch mode
            result = asyncio.run(fetch_url_content(
                args.fetch_url,
                include_html=args.include_html,
                max_length=args.max_length
            ))
        elif args.fetch_content:
            # Combined search + fetch mode
            result = asyncio.run(search_and_fetch(
                args.query,
                max_results=args.max_results,
                top_n=args.top_n,
                max_length=args.max_length
            ))
        else:
            # Search only mode
            result = ddg_web_search(args.query, args.max_results)

        # Output result
        indent = 2 if args.pretty else None
        print(json.dumps(result, indent=indent))

        # Exit with appropriate code
        sys.exit(0 if result.get("success") else 1)

    except KeyboardInterrupt:
        logger.info("Operation cancelled by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        error_result = {
            "success": False,
            "error": str(e)
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == '__main__':
    main()
