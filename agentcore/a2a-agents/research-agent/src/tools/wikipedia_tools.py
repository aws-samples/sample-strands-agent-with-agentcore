"""
Wikipedia Tools - Local Implementation
- Wikipedia search
- Wikipedia article retrieval
"""

import json
import logging
from typing import Optional
from strands import tool

logger = logging.getLogger(__name__)


@tool
async def wikipedia_search(query: str) -> str:
    """
    Search Wikipedia for articles matching the query.
    Returns article titles, snippets, and URLs.

    Args:
        query: Search query string (e.g., "Python programming", "Machine learning")

    Returns:
        JSON string containing search results with title, snippet, and URL

    Examples:
        # General search
        wikipedia_search("Artificial intelligence")

        # Historical figures
        wikipedia_search("Albert Einstein")

        # Scientific topics
        wikipedia_search("Quantum mechanics")
    """
    try:
        import wikipediaapi

        wiki = wikipediaapi.Wikipedia(
            user_agent='ResearchAgent/1.0',
            language='en'
        )

        # Search by trying to get the page
        search_page = wiki.page(query)

        results = []

        # Add the main search result if it exists
        if search_page.exists():
            summary = search_page.summary
            snippet = summary[:200] + "..." if len(summary) > 200 else summary

            results.append({
                "title": search_page.title,
                "snippet": snippet,
                "url": search_page.fullurl
            })

        if not results:
            return json.dumps({
                "success": True,
                "status": "no_results",
                "query": query,
                "message": f"No Wikipedia articles found for query: {query}",
                "results": []
            }, indent=2)
        else:
            return json.dumps({
                "success": True,
                "status": "success",
                "query": query,
                "count": len(results),
                "results": results
            }, indent=2)

    except ImportError:
        error_msg = "wikipediaapi library not installed. Please install it with: pip install wikipedia-api"
        logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg,
            "query": query
        })

    except Exception as e:
        logger.error(f"Error performing Wikipedia search: {e}")
        return json.dumps({
            "success": False,
            "error": str(e),
            "query": query
        })


@tool
async def wikipedia_get_article(title: str, summary_only: bool = False) -> str:
    """
    Retrieve content from a Wikipedia article by exact title.
    Use after wikipedia_search to get the correct article title.

    Args:
        title: Exact Wikipedia article title (e.g., "Python (programming language)")
        summary_only: If True, returns only summary; if False, returns full content (default: False)

    Returns:
        JSON string with article content, URL, categories, and metadata

    Examples:
        # Get article summary
        wikipedia_get_article("Machine learning", summary_only=True)

        # Get full article (up to 5000 characters)
        wikipedia_get_article("Artificial intelligence")

        # Get specific article
        wikipedia_get_article("Python (programming language)")
    """
    try:
        import wikipediaapi

        wiki = wikipediaapi.Wikipedia(
            user_agent='ResearchAgent/1.0',
            language='en'
        )

        page = wiki.page(title)

        if not page.exists():
            return json.dumps({
                "success": True,
                "status": "not_found",
                "title": title,
                "message": f"Wikipedia article not found: {title}",
                "suggestion": "Try using wikipedia_search to find the correct article title"
            }, indent=2)

        # Get content based on summary_only flag
        if summary_only:
            content = page.summary
            content_type = "summary"
        else:
            # Limit full text to 5000 characters
            content = page.text[:5000]
            content_type = "full_text"
            if len(page.text) > 5000:
                content += "\n\n[... Content truncated at 5000 characters]"

        # Get categories for context
        categories = list(page.categories.keys())[:5]  # Limit to 5 categories

        return json.dumps({
            "success": True,
            "status": "success",
            "title": page.title,
            "content_type": content_type,
            "content": content,
            "url": page.fullurl,
            "categories": categories,
            "character_count": len(content)
        }, indent=2)

    except ImportError:
        error_msg = "wikipediaapi library not installed. Please install it with: pip install wikipedia-api"
        logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg,
            "title": title
        })

    except Exception as e:
        logger.error(f"Error retrieving Wikipedia article: {e}")
        return json.dumps({
            "success": False,
            "error": str(e),
            "title": title
        })
