"""Local tools for general-purpose tasks

This package contains tools that don't require specific AWS services:
- Web search
- URL fetching and content extraction
- Data visualization
"""

from .web_search import ddg_web_search
from .url_fetcher import fetch_url_content
from .visualization import create_visualization
from .excalidraw import create_excalidraw_diagram

__all__ = [
    'ddg_web_search',
    'fetch_url_content',
    'create_visualization',
    'create_excalidraw_diagram',
]
