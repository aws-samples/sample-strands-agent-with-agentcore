"""
Research Agent Tools Package

Exports all tools for use by the Research Agent:
- Web search tools (DuckDuckGo, URL fetcher)
- Wikipedia tools (search, article retrieval)
- Markdown writing tools (section-based markdown generation)
"""

# Web search tools
from tools.web_search_tools import ddg_web_search, fetch_url_content

# Wikipedia tools
from tools.wikipedia_tools import wikipedia_search, wikipedia_get_article

# Markdown writing tools
from tools.markdown_writer import (
    write_markdown_section,
    add_markdown_reference,
    read_markdown_file
)

__all__ = [
    # Web search
    "ddg_web_search",
    "fetch_url_content",
    # Wikipedia
    "wikipedia_search",
    "wikipedia_get_article",
    # Markdown writing
    "write_markdown_section",
    "add_markdown_reference",
    "read_markdown_file",
]
