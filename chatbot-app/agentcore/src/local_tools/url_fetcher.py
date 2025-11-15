"""
Simple URL Fetcher Tool - Strands Native
Fetches and extracts text content from web pages
"""

import json
import logging
from typing import Optional
from strands import tool

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
        # If BeautifulSoup not available, return raw text with basic cleanup
        import re
        # Remove HTML tags
        text = re.sub(r'<[^>]+>', '', html)
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        if len(text) > max_length:
            text = text[:max_length] + "\n\n[Content truncated...]"

        return text


@tool
async def fetch_url_content(
    url: str,
    include_html: bool = False,
    max_length: int = 50000
) -> str:
    """
    Fetch and extract text content from a web page URL.
    Useful for retrieving job descriptions, articles, documentation, or any web content.

    Args:
        url: The URL to fetch (must start with http:// or https://)
        include_html: If True, includes raw HTML in response (default: False)
        max_length: Maximum character length of extracted text (default: 50000)

    Returns:
        JSON string with extracted text content, title, and metadata

    Examples:
        # Fetch job posting
        fetch_url_content("https://jobs.example.com/senior-engineer")

        # Fetch article
        fetch_url_content("https://blog.example.com/tech-trends-2025")

        # Fetch with HTML
        fetch_url_content("https://example.com", include_html=True)
    """
    try:
        import httpx

        # Validate URL
        if not url.startswith(('http://', 'https://')):
            return json.dumps({
                "success": False,
                "error": "URL must start with http:// or https://",
                "url": url
            })

        # Fetch URL with timeout
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            headers = {
                "User-Agent": "Mozilla/5.0 (compatible; StrandsAgent/1.0; +https://strands.ai)"
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

            return json.dumps(result, indent=2)

    except httpx.HTTPStatusError as e:
        error_msg = f"HTTP error {e.response.status_code}: {e.response.reason_phrase}"
        logger.error(f"HTTP error fetching {url}: {error_msg}")
        return json.dumps({
            "success": False,
            "error": error_msg,
            "url": url,
            "status_code": e.response.status_code
        })

    except httpx.TimeoutException:
        error_msg = "Request timed out (30 seconds)"
        logger.error(f"Timeout fetching {url}")
        return json.dumps({
            "success": False,
            "error": error_msg,
            "url": url
        })

    except Exception as e:
        logger.error(f"Error fetching URL {url}: {e}")
        return json.dumps({
            "success": False,
            "error": str(e),
            "url": url
        })
