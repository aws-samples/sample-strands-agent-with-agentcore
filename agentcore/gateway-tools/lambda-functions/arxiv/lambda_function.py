"""
ArXiv Lambda for AgentCore Gateway
Provides ArXiv paper search and retrieval
"""
import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Import after logger setup
import arxiv

def lambda_handler(event, context):
    """
    Lambda handler for ArXiv tools via AgentCore Gateway

    Gateway unwraps tool arguments and passes them directly to Lambda
    """
    try:
        logger.info(f"Event: {json.dumps(event)}")

        # Get tool name from context (set by AgentCore Gateway)
        tool_name = 'unknown'
        if hasattr(context, 'client_context') and context.client_context:
            if hasattr(context.client_context, 'custom'):
                tool_name = context.client_context.custom.get('bedrockAgentCoreToolName', '')
                if '___' in tool_name:
                    tool_name = tool_name.split('___')[-1]

        logger.info(f"Tool name: {tool_name}")

        # Route to appropriate tool
        if tool_name == 'arxiv_search':
            return arxiv_search(event)
        elif tool_name == 'arxiv_get_paper':
            return arxiv_get_paper(event)
        else:
            return error_response(f"Unknown tool: {tool_name}")

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        return error_response(str(e))


def arxiv_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute ArXiv paper search"""

    # Extract parameters (Gateway unwraps them)
    query = params.get('query')
    max_results = 5

    if not query:
        return error_response("query parameter required")

    logger.info(f"ArXiv search: query={query}")

    try:
        # Create search client
        client = arxiv.Client()

        # Perform search
        search = arxiv.Search(
            query=query,
            max_results=max_results,
            sort_by=arxiv.SortCriterion.Relevance
        )

        # Get results
        results = []
        for idx, paper in enumerate(client.results(search), 1):
            # Get paper ID from URL
            paper_id = paper.entry_id.split('/')[-1]

            results.append({
                "index": idx,
                "title": paper.title,
                "authors": ", ".join([author.name for author in paper.authors]),
                "published": paper.published.strftime("%Y-%m-%d"),
                "paper_id": paper_id,
                "abstract": paper.summary
            })

        result_data = {
            "query": query,
            "results_count": len(results),
            "results": results
        }

        return success_response(json.dumps(result_data, indent=2))

    except Exception as e:
        return error_response(f"ArXiv search error: {str(e)}")


def arxiv_get_paper(params: Dict[str, Any]) -> Dict[str, Any]:
    """Get detailed ArXiv paper content"""

    # Extract parameters
    paper_ids = params.get('paper_ids')

    if not paper_ids:
        return error_response("paper_ids parameter required")

    # Parse comma-separated IDs
    id_list = [pid.strip() for pid in paper_ids.split(",")]

    logger.info(f"ArXiv get paper: {len(id_list)} paper(s)")

    results = []
    client = arxiv.Client()

    for paper_id in id_list:
        try:
            # Clean paper ID
            if "/" in paper_id:
                paper_id = paper_id.split("/")[-1]

            # Search for paper by ID
            search = arxiv.Search(id_list=[paper_id])
            papers = list(client.results(search))

            if not papers:
                results.append({
                    "paper_id": paper_id,
                    "error": f"No paper found with ID {paper_id}"
                })
                continue

            paper = papers[0]

            # Get full text (truncated to 5000 chars)
            full_text = paper.summary
            if len(full_text) > 5000:
                content_preview = full_text[:5000] + "... [Content truncated]"
            else:
                content_preview = full_text

            results.append({
                "paper_id": paper_id,
                "title": paper.title,
                "authors": ", ".join([author.name for author in paper.authors]),
                "published": paper.published.strftime("%Y-%m-%d"),
                "summary": paper.summary[:500] + "..." if len(paper.summary) > 500 else paper.summary,
                "content_preview": content_preview,
                "pdf_url": paper.pdf_url,
                "categories": paper.categories
            })

        except Exception as e:
            results.append({
                "paper_id": paper_id,
                "error": f"Failed to get paper: {str(e)}"
            })

    result_data = {
        "papers_retrieved": len(results),
        "papers": results
    }

    return success_response(json.dumps(result_data, indent=2))


def success_response(content: str) -> Dict[str, Any]:
    """Format successful MCP response"""
    return {
        'statusCode': 200,
        'body': json.dumps({
            'content': [{
                'type': 'text',
                'text': content
            }]
        })
    }


def error_response(message: str) -> Dict[str, Any]:
    """Format error response"""
    logger.error(f"Error response: {message}")
    return {
        'statusCode': 400,
        'body': json.dumps({
            'error': message
        })
    }
