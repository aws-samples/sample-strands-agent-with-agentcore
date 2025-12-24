"""Local tools for general-purpose tasks

This package contains tools that don't require specific AWS services:
- Weather lookup
- Web search
- URL fetching and content extraction
- Data visualization
- Map visualization
"""

from .weather import get_current_weather
from .web_search import ddg_web_search
from .url_fetcher import fetch_url_content
from .visualization import create_visualization
from .map_tool import show_on_map

__all__ = [
    'get_current_weather',
    'ddg_web_search',
    'fetch_url_content',
    'create_visualization',
    'show_on_map',
]
