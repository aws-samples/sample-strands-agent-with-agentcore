"""
Tests for ArXiv Lambda function

Tests cover:
- Parameter validation
- Search result formatting
- Paper retrieval
- Error handling
- Response structure
"""
import pytest
import json
import sys
from unittest.mock import patch, MagicMock
from datetime import datetime

# Add lambda function path
sys.path.insert(0, str(__file__).replace('/tests/test_arxiv_lambda.py', '/lambda-functions/arxiv'))


# ============================================================
# Mock Lambda Context
# ============================================================

class MockClientContext:
    def __init__(self, tool_name: str = 'unknown'):
        self.custom = {'bedrockAgentCoreToolName': tool_name}


class MockContext:
    def __init__(self, tool_name: str = 'unknown'):
        self.client_context = MockClientContext(tool_name)


# ============================================================
# ArXiv Search Tests
# ============================================================

class TestArxivSearch:
    """Tests for arxiv_search function."""

    @patch('arxiv.Client')
    def test_successful_search(self, mock_client_class):
        """Test successful ArXiv search returns formatted results."""
        from lambda_function import arxiv_search

        # Create mock paper
        mock_paper = MagicMock()
        mock_paper.title = "Test Paper Title"
        mock_paper.authors = [MagicMock(name="Author One"), MagicMock(name="Author Two")]
        mock_paper.authors[0].name = "Author One"
        mock_paper.authors[1].name = "Author Two"
        mock_paper.published = datetime(2024, 1, 15)
        mock_paper.entry_id = "http://arxiv.org/abs/2401.12345"
        mock_paper.summary = "This is the paper abstract."

        mock_client = MagicMock()
        mock_client.results.return_value = iter([mock_paper])
        mock_client_class.return_value = mock_client

        result = arxiv_search({"query": "machine learning"})

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        content = json.loads(body['content'][0]['text'])

        assert content['query'] == "machine learning"
        assert content['results_count'] == 1
        assert len(content['results']) == 1
        assert content['results'][0]['title'] == "Test Paper Title"
        assert content['results'][0]['paper_id'] == "2401.12345"

    def test_missing_query_parameter(self):
        """Test that missing query returns error."""
        from lambda_function import arxiv_search

        result = arxiv_search({})

        assert result['statusCode'] == 400
        body = json.loads(result['body'])
        assert 'error' in body
        assert 'query' in body['error'].lower()

    def test_empty_query_parameter(self):
        """Test that empty query returns error."""
        from lambda_function import arxiv_search

        result = arxiv_search({"query": ""})

        assert result['statusCode'] == 400

    @patch('arxiv.Client')
    def test_empty_search_results(self, mock_client_class):
        """Test handling of no search results."""
        from lambda_function import arxiv_search

        mock_client = MagicMock()
        mock_client.results.return_value = iter([])
        mock_client_class.return_value = mock_client

        result = arxiv_search({"query": "extremely obscure topic xyz123"})

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        content = json.loads(body['content'][0]['text'])
        assert content['results_count'] == 0
        assert content['results'] == []

    @patch('arxiv.Client')
    def test_search_formats_authors_correctly(self, mock_client_class):
        """Test that multiple authors are formatted as comma-separated string."""
        from lambda_function import arxiv_search

        mock_paper = MagicMock()
        mock_paper.title = "Multi-Author Paper"
        mock_paper.authors = [MagicMock(), MagicMock(), MagicMock()]
        mock_paper.authors[0].name = "Alice"
        mock_paper.authors[1].name = "Bob"
        mock_paper.authors[2].name = "Charlie"
        mock_paper.published = datetime(2024, 6, 1)
        mock_paper.entry_id = "http://arxiv.org/abs/2406.00001"
        mock_paper.summary = "Abstract"

        mock_client = MagicMock()
        mock_client.results.return_value = iter([mock_paper])
        mock_client_class.return_value = mock_client

        result = arxiv_search({"query": "test"})
        body = json.loads(result['body'])
        content = json.loads(body['content'][0]['text'])

        assert content['results'][0]['authors'] == "Alice, Bob, Charlie"


# ============================================================
# ArXiv Get Paper Tests
# ============================================================

class TestArxivGetPaper:
    """Tests for arxiv_get_paper function."""

    @patch('arxiv.Client')
    def test_successful_paper_retrieval(self, mock_client_class):
        """Test successful paper retrieval."""
        from lambda_function import arxiv_get_paper

        mock_paper = MagicMock()
        mock_paper.title = "Retrieved Paper"
        mock_paper.authors = [MagicMock()]
        mock_paper.authors[0].name = "Test Author"
        mock_paper.published = datetime(2024, 3, 10)
        mock_paper.summary = "Paper summary text"
        mock_paper.pdf_url = "https://arxiv.org/pdf/2403.12345.pdf"
        mock_paper.categories = ["cs.AI", "cs.LG"]

        mock_client = MagicMock()
        mock_client.results.return_value = iter([mock_paper])
        mock_client_class.return_value = mock_client

        result = arxiv_get_paper({"paper_ids": "2403.12345"})

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        content = json.loads(body['content'][0]['text'])

        assert content['papers_retrieved'] == 1
        assert content['papers'][0]['title'] == "Retrieved Paper"
        assert content['papers'][0]['pdf_url'] == "https://arxiv.org/pdf/2403.12345.pdf"

    def test_missing_paper_ids(self):
        """Test that missing paper_ids returns error."""
        from lambda_function import arxiv_get_paper

        result = arxiv_get_paper({})

        assert result['statusCode'] == 400
        body = json.loads(result['body'])
        assert 'error' in body

    @patch('arxiv.Client')
    def test_multiple_paper_ids(self, mock_client_class):
        """Test retrieval of multiple papers."""
        from lambda_function import arxiv_get_paper

        mock_paper1 = MagicMock()
        mock_paper1.title = "Paper 1"
        mock_paper1.authors = [MagicMock()]
        mock_paper1.authors[0].name = "Author 1"
        mock_paper1.published = datetime(2024, 1, 1)
        mock_paper1.summary = "Summary 1"
        mock_paper1.pdf_url = "https://arxiv.org/pdf/1.pdf"
        mock_paper1.categories = ["cs.AI"]

        mock_paper2 = MagicMock()
        mock_paper2.title = "Paper 2"
        mock_paper2.authors = [MagicMock()]
        mock_paper2.authors[0].name = "Author 2"
        mock_paper2.published = datetime(2024, 2, 1)
        mock_paper2.summary = "Summary 2"
        mock_paper2.pdf_url = "https://arxiv.org/pdf/2.pdf"
        mock_paper2.categories = ["cs.LG"]

        mock_client = MagicMock()
        # Return different papers for different searches
        mock_client.results.side_effect = [iter([mock_paper1]), iter([mock_paper2])]
        mock_client_class.return_value = mock_client

        result = arxiv_get_paper({"paper_ids": "2401.00001, 2402.00002"})

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        content = json.loads(body['content'][0]['text'])

        assert content['papers_retrieved'] == 2

    @patch('arxiv.Client')
    def test_paper_not_found(self, mock_client_class):
        """Test handling of paper not found."""
        from lambda_function import arxiv_get_paper

        mock_client = MagicMock()
        mock_client.results.return_value = iter([])
        mock_client_class.return_value = mock_client

        result = arxiv_get_paper({"paper_ids": "9999.99999"})

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        content = json.loads(body['content'][0]['text'])

        assert content['papers'][0]['error'] is not None

    @patch('arxiv.Client')
    def test_long_summary_truncation(self, mock_client_class):
        """Test that long summaries are truncated."""
        from lambda_function import arxiv_get_paper

        mock_paper = MagicMock()
        mock_paper.title = "Paper with Long Summary"
        mock_paper.authors = [MagicMock()]
        mock_paper.authors[0].name = "Author"
        mock_paper.published = datetime(2024, 1, 1)
        mock_paper.summary = "A" * 10000  # Very long summary
        mock_paper.pdf_url = "https://arxiv.org/pdf/test.pdf"
        mock_paper.categories = ["cs.AI"]

        mock_client = MagicMock()
        mock_client.results.return_value = iter([mock_paper])
        mock_client_class.return_value = mock_client

        result = arxiv_get_paper({"paper_ids": "test.12345"})

        body = json.loads(result['body'])
        content = json.loads(body['content'][0]['text'])

        # Summary in response should be truncated
        assert len(content['papers'][0]['summary']) <= 510  # 500 + "..."


# ============================================================
# Lambda Handler Tests
# ============================================================

class TestLambdaHandler:
    """Tests for lambda_handler routing."""

    @patch('arxiv.Client')
    def test_routes_to_arxiv_search(self, mock_client_class):
        """Test that handler routes to arxiv_search correctly."""
        from lambda_function import lambda_handler

        mock_client = MagicMock()
        mock_client.results.return_value = iter([])
        mock_client_class.return_value = mock_client

        context = MockContext('arxiv_search')
        result = lambda_handler({"query": "test"}, context)

        assert result['statusCode'] == 200

    @patch('arxiv.Client')
    def test_routes_to_arxiv_get_paper(self, mock_client_class):
        """Test that handler routes to arxiv_get_paper correctly."""
        from lambda_function import lambda_handler

        mock_client = MagicMock()
        mock_client.results.return_value = iter([])
        mock_client_class.return_value = mock_client

        context = MockContext('arxiv_get_paper')
        result = lambda_handler({"paper_ids": "test"}, context)

        assert result['statusCode'] == 200

    def test_unknown_tool_returns_error(self):
        """Test that unknown tool name returns error."""
        from lambda_function import lambda_handler

        context = MockContext('unknown_tool')
        result = lambda_handler({}, context)

        assert result['statusCode'] == 400
        body = json.loads(result['body'])
        assert 'Unknown tool' in body['error']

    def test_handles_tool_name_with_prefix(self):
        """Test that tool names with prefix are parsed correctly."""
        from lambda_function import lambda_handler

        context = MockContext('prefix___arxiv_search')

        with patch('arxiv.Client') as mock_client_class:
            mock_client = MagicMock()
            mock_client.results.return_value = iter([])
            mock_client_class.return_value = mock_client

            result = lambda_handler({"query": "test"}, context)

        assert result['statusCode'] == 200


# ============================================================
# Response Format Tests
# ============================================================

class TestResponseFormat:
    """Tests for response formatting."""

    def test_success_response_format(self):
        """Test success response has correct MCP format."""
        from lambda_function import success_response

        result = success_response('{"test": "data"}')

        assert result['statusCode'] == 200
        body = json.loads(result['body'])
        assert 'content' in body
        assert body['content'][0]['type'] == 'text'
        assert body['content'][0]['text'] == '{"test": "data"}'

    def test_error_response_format(self):
        """Test error response has correct format."""
        from lambda_function import error_response

        result = error_response("Test error message")

        assert result['statusCode'] == 400
        body = json.loads(result['body'])
        assert body['error'] == "Test error message"
