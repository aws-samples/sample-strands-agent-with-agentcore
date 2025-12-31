"""
Tests for url_fetcher local tool

Tests cover:
- URL validation
- HTML text extraction
- HTTP error handling
- Timeout handling
- Content truncation
"""
import pytest
import json
from unittest.mock import patch, AsyncMock, MagicMock


# ============================================================
# HTML Text Extraction Tests
# ============================================================

class TestExtractTextFromHtml:
    """Tests for extract_text_from_html function."""

    def test_extracts_text_from_simple_html(self):
        """Test basic text extraction from HTML."""
        from local_tools.url_fetcher import extract_text_from_html

        html = "<html><body><p>Hello World</p></body></html>"
        result = extract_text_from_html(html)

        assert "Hello World" in result

    def test_removes_script_tags(self):
        """Test that script tags are removed."""
        from local_tools.url_fetcher import extract_text_from_html

        html = """
        <html>
        <body>
            <p>Visible content</p>
            <script>console.log('hidden');</script>
        </body>
        </html>
        """
        result = extract_text_from_html(html)

        assert "Visible content" in result
        assert "console.log" not in result

    def test_removes_style_tags(self):
        """Test that style tags are removed."""
        from local_tools.url_fetcher import extract_text_from_html

        html = """
        <html>
        <head><style>body { color: red; }</style></head>
        <body><p>Content</p></body>
        </html>
        """
        result = extract_text_from_html(html)

        assert "Content" in result
        assert "color: red" not in result

    def test_removes_nav_footer_header(self):
        """Test that nav, footer, header are removed."""
        from local_tools.url_fetcher import extract_text_from_html

        html = """
        <html>
        <body>
            <header>Header content</header>
            <nav>Navigation</nav>
            <main><p>Main content</p></main>
            <footer>Footer content</footer>
        </body>
        </html>
        """
        result = extract_text_from_html(html)

        assert "Main content" in result
        # Navigation elements should be removed
        assert "Navigation" not in result
        assert "Footer content" not in result

    def test_truncates_long_content(self):
        """Test that content is truncated to max_length."""
        from local_tools.url_fetcher import extract_text_from_html

        html = "<html><body>" + "A" * 100000 + "</body></html>"
        result = extract_text_from_html(html, max_length=1000)

        assert len(result) <= 1100  # Some buffer for truncation message
        assert "[Content truncated...]" in result

    def test_cleans_whitespace(self):
        """Test that excessive whitespace is cleaned."""
        from local_tools.url_fetcher import extract_text_from_html

        html = """
        <html>
        <body>
            <p>Line 1</p>


            <p>Line 2</p>
        </body>
        </html>
        """
        result = extract_text_from_html(html)

        # Should not have multiple blank lines
        assert "\n\n\n" not in result

    def test_handles_empty_html(self):
        """Test handling of empty HTML."""
        from local_tools.url_fetcher import extract_text_from_html

        html = ""
        result = extract_text_from_html(html)

        assert result == ""

    def test_handles_text_only(self):
        """Test handling of plain text without HTML tags."""
        from local_tools.url_fetcher import extract_text_from_html

        html = "Just plain text"
        result = extract_text_from_html(html)

        assert "Just plain text" in result


# ============================================================
# URL Fetcher Tool Tests
# ============================================================

class TestFetchUrlContent:
    """Tests for fetch_url_content tool function."""

    @pytest.mark.asyncio
    async def test_rejects_invalid_url_scheme(self):
        """Test that invalid URL schemes are rejected."""
        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("ftp://example.com")
        data = json.loads(result)

        assert data["success"] is False
        assert "http://" in data["error"] or "https://" in data["error"]

    @pytest.mark.asyncio
    async def test_rejects_relative_url(self):
        """Test that relative URLs are rejected."""
        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("/path/to/page")
        data = json.loads(result)

        assert data["success"] is False

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_successful_fetch(self, mock_client_class):
        """Test successful URL fetch."""
        # Setup mock
        mock_response = MagicMock()
        mock_response.text = "<html><head><title>Test Page</title></head><body>Hello World</body></html>"
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://example.com")
        data = json.loads(result)

        assert data["success"] is True
        assert data["url"] == "https://example.com"
        assert data["title"] == "Test Page"
        assert "Hello World" in data["text_content"]
        assert data["status_code"] == 200

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_includes_html_when_requested(self, mock_client_class):
        """Test that HTML is included when include_html=True."""
        mock_response = MagicMock()
        mock_response.text = "<html><body>Content</body></html>"
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://example.com", include_html=True)
        data = json.loads(result)

        assert "html_content" in data
        assert "<html>" in data["html_content"]

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_excludes_html_by_default(self, mock_client_class):
        """Test that HTML is excluded by default."""
        mock_response = MagicMock()
        mock_response.text = "<html><body>Content</body></html>"
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://example.com")
        data = json.loads(result)

        assert "html_content" not in data


# ============================================================
# Error Handling Tests
# ============================================================

class TestUrlFetcherErrorHandling:
    """Tests for URL fetcher error handling."""

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_handles_http_404_error(self, mock_client_class):
        """Test handling of HTTP 404 error."""
        import httpx

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.reason_phrase = "Not Found"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "Not Found",
                request=MagicMock(),
                response=mock_response
            )
        )
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://example.com/notfound")
        data = json.loads(result)

        assert data["success"] is False
        assert "404" in data["error"]
        assert data["status_code"] == 404

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_handles_http_500_error(self, mock_client_class):
        """Test handling of HTTP 500 error."""
        import httpx

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.reason_phrase = "Internal Server Error"

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "Server Error",
                request=MagicMock(),
                response=mock_response
            )
        )
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://example.com/error")
        data = json.loads(result)

        assert data["success"] is False
        assert "500" in data["error"]

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_handles_timeout(self, mock_client_class):
        """Test handling of request timeout."""
        import httpx

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://slow-server.com")
        data = json.loads(result)

        assert data["success"] is False
        assert "timed out" in data["error"].lower()

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_handles_connection_error(self, mock_client_class):
        """Test handling of connection error."""
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=Exception("Connection refused"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://unreachable.com")
        data = json.loads(result)

        assert data["success"] is False
        assert "Connection refused" in data["error"]


# ============================================================
# Response Format Tests
# ============================================================

class TestUrlFetcherResponseFormat:
    """Tests for URL fetcher response format."""

    @pytest.mark.asyncio
    async def test_error_response_includes_url(self):
        """Test that error responses include the URL."""
        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("invalid-url")
        data = json.loads(result)

        assert "url" in data
        assert data["url"] == "invalid-url"

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_success_response_includes_metadata(self, mock_client_class):
        """Test that success response includes all metadata."""
        mock_response = MagicMock()
        mock_response.text = "<html><head><title>Test</title></head><body>Content</body></html>"
        mock_response.headers = {'content-type': 'text/html; charset=utf-8'}
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://example.com")
        data = json.loads(result)

        assert "url" in data
        assert "title" in data
        assert "content_type" in data
        assert "text_content" in data
        assert "text_length" in data
        assert "status_code" in data

    @pytest.mark.asyncio
    @patch('httpx.AsyncClient')
    async def test_text_length_matches_content(self, mock_client_class):
        """Test that text_length matches actual content length."""
        mock_response = MagicMock()
        mock_response.text = "<html><body>Hello World!</body></html>"
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        from local_tools.url_fetcher import fetch_url_content

        result = await fetch_url_content("https://example.com")
        data = json.loads(result)

        assert data["text_length"] == len(data["text_content"])

    @pytest.mark.asyncio
    async def test_returns_valid_json(self):
        """Test that tool always returns valid JSON."""
        from local_tools.url_fetcher import fetch_url_content

        # Test with invalid URL
        result = await fetch_url_content("not-a-url")

        # Should not raise
        data = json.loads(result)
        assert isinstance(data, dict)
