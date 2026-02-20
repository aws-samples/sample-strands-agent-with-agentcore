"""
Tests for web_search local tool

Tests cover:
- Search execution
- Result formatting
- Error handling
- Max results limiting
"""
import pytest
import json
from unittest.mock import patch, MagicMock


# ============================================================
# Web Search Tool Tests
# ============================================================

class TestDdgWebSearch:
    """Tests for ddg_web_search tool function."""

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_successful_search(self, mock_ddgs_class):
        """Test successful web search."""
        # Setup mock
        mock_results = [
            {"title": "Result 1", "body": "Description 1", "href": "https://example1.com"},
            {"title": "Result 2", "body": "Description 2", "href": "https://example2.com"}
        ]

        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = mock_results
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test query")
        data = json.loads(result)

        assert data["success"] is True
        assert data["query"] == "test query"
        assert data["result_count"] == 2
        assert len(data["results"]) == 2

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_search_returns_formatted_results(self, mock_ddgs_class):
        """Test that search results are properly formatted."""
        mock_results = [
            {"title": "Python Tutorial", "body": "Learn Python basics", "href": "https://python.org/tutorial"}
        ]

        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = mock_results
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("python tutorial")
        data = json.loads(result)

        first_result = data["results"][0]
        assert first_result["index"] == 1
        assert first_result["title"] == "Python Tutorial"
        assert first_result["snippet"] == "Learn Python basics"
        assert first_result["link"] == "https://python.org/tutorial"

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_respects_max_results_parameter(self, mock_ddgs_class):
        """Test that max_results parameter is respected."""
        mock_results = [
            {"title": f"Result {i}", "body": f"Body {i}", "href": f"https://example{i}.com"}
            for i in range(10)
        ]

        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = mock_results
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test", max_results=3)
        data = json.loads(result)

        # Mock returns 10, but we asked for 3
        # The function passes max_results to ddgs.text
        mock_ddgs.text.assert_called_with("test", max_results=3)

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_limits_max_results_to_10(self, mock_ddgs_class):
        """Test that max_results is capped at 10."""
        mock_results = []

        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = mock_results
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        # Request 100 results
        await ddg_web_search("test", max_results=100)

        # Should be limited to 10
        mock_ddgs.text.assert_called_with("test", max_results=10)

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_handles_empty_results(self, mock_ddgs_class):
        """Test handling of empty search results."""
        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = []
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("extremely obscure search query")
        data = json.loads(result)

        assert data["success"] is True
        assert data["result_count"] == 0
        assert data["results"] == []


# ============================================================
# Error Handling Tests
# ============================================================

class TestWebSearchErrorHandling:
    """Tests for web search error handling."""

    @pytest.mark.asyncio
    async def test_handles_missing_ddgs_library(self):
        """Test handling when ddgs library is not installed."""
        import sys

        # Temporarily remove ddgs from sys.modules to simulate it not being installed
        ddgs_module = sys.modules.get('ddgs')
        if 'ddgs' in sys.modules:
            del sys.modules['ddgs']

        # Also remove cached web_search module
        if 'local_tools.web_search' in sys.modules:
            del sys.modules['local_tools.web_search']

        try:
            # Mock ddgs import to raise ImportError
            with patch.dict('sys.modules', {'ddgs': None}):
                # Re-import the module to get fresh import behavior
                from local_tools.web_search import ddg_web_search

                result = await ddg_web_search("test query")
                data = json.loads(result)

                assert data["success"] is False
                assert "ddgs" in data["error"].lower() or "not installed" in data["error"].lower()
        finally:
            # Restore ddgs module
            if ddgs_module is not None:
                sys.modules['ddgs'] = ddgs_module

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_handles_search_exception(self, mock_ddgs_class):
        """Test handling of search exceptions."""
        mock_ddgs = MagicMock()
        mock_ddgs.text.side_effect = Exception("Search failed")
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test query")
        data = json.loads(result)

        assert data["success"] is False
        assert "Search failed" in data["error"]
        assert data["query"] == "test query"

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_handles_network_error(self, mock_ddgs_class):
        """Test handling of network errors."""
        mock_ddgs = MagicMock()
        mock_ddgs.text.side_effect = ConnectionError("Network unreachable")
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test query")
        data = json.loads(result)

        assert data["success"] is False
        assert "Network unreachable" in data["error"]

    @pytest.mark.asyncio
    async def test_handles_timeout(self):
        """Test that a hanging search is caught and returns a timeout error."""
        import asyncio as _asyncio
        import local_tools.web_search as ws_module

        # Simulate a search that never returns
        async def _hanging_future(*args, **kwargs):
            await _asyncio.sleep(999)

        with patch.object(ws_module, '_TIMEOUT_SECONDS', 0.05), \
             patch('asyncio.wait_for', side_effect=_asyncio.TimeoutError):
            from local_tools.web_search import ddg_web_search
            result = await ddg_web_search("hanging query")
            data = json.loads(result)

        assert data["success"] is False
        assert "timed out" in data["error"].lower()
        assert data["query"] == "hanging query"


# ============================================================
# Result Format Tests
# ============================================================

class TestSearchResultFormat:
    """Tests for search result formatting."""

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_handles_missing_title(self, mock_ddgs_class):
        """Test handling of results with missing title."""
        mock_results = [
            {"body": "Description only", "href": "https://example.com"}
        ]

        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = mock_results
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test")
        data = json.loads(result)

        assert data["results"][0]["title"] == "No title"

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_handles_missing_body(self, mock_ddgs_class):
        """Test handling of results with missing body."""
        mock_results = [
            {"title": "Title only", "href": "https://example.com"}
        ]

        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = mock_results
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test")
        data = json.loads(result)

        assert data["results"][0]["snippet"] == "No snippet"

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_handles_missing_href(self, mock_ddgs_class):
        """Test handling of results with missing href."""
        mock_results = [
            {"title": "Title", "body": "Body"}
        ]

        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = mock_results
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test")
        data = json.loads(result)

        assert data["results"][0]["link"] == "No link"

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_results_have_sequential_index(self, mock_ddgs_class):
        """Test that results have sequential index numbers."""
        mock_results = [
            {"title": f"Result {i}", "body": f"Body {i}", "href": f"https://example{i}.com"}
            for i in range(5)
        ]

        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = mock_results
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test")
        data = json.loads(result)

        for i, item in enumerate(data["results"]):
            assert item["index"] == i + 1  # 1-based index


# ============================================================
# Response Format Tests
# ============================================================

class TestWebSearchResponseFormat:
    """Tests for web search response format."""

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_success_response_has_required_fields(self, mock_ddgs_class):
        """Test that success response has all required fields."""
        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = []
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test")
        data = json.loads(result)

        assert "success" in data
        assert "query" in data
        assert "result_count" in data
        assert "results" in data

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_error_response_has_required_fields(self, mock_ddgs_class):
        """Test that error response has all required fields."""
        mock_ddgs = MagicMock()
        mock_ddgs.text.side_effect = Exception("Error")
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test")
        data = json.loads(result)

        assert "success" in data
        assert "error" in data
        assert "query" in data

    @pytest.mark.asyncio
    @patch('ddgs.DDGS')
    async def test_returns_valid_json(self, mock_ddgs_class):
        """Test that tool always returns valid JSON."""
        mock_ddgs = MagicMock()
        mock_ddgs.text.return_value = []
        mock_ddgs.__enter__ = MagicMock(return_value=mock_ddgs)
        mock_ddgs.__exit__ = MagicMock(return_value=None)
        mock_ddgs_class.return_value = mock_ddgs

        from local_tools.web_search import ddg_web_search

        result = await ddg_web_search("test")

        # Should not raise
        data = json.loads(result)
        assert isinstance(data, dict)
