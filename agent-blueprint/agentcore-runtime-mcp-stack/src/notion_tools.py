"""
Notion Tools for MCP Server

Provides Notion tools with per-user OAuth authentication.
These tools are registered to a shared FastMCP instance.

Tools:
- search: Search pages and databases
- list_databases: List accessible databases
- query_database: Query a database with filters
- get_page: Get page properties
- create_page: Create a new page
- update_page: Update page properties
- get_block_children: Get page content (blocks)
- append_block_children: Add content to a page
"""
import json
import httpx
import logging
from typing import Any, Dict, List, Optional

from mcp.server.fastmcp import Context
from agentcore_oauth import OAuthHelper, get_token_with_elicitation

logger = logging.getLogger(__name__)

# Notion API configuration
NOTION_API_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"

# OAuth helper for Notion
_notion_oauth = OAuthHelper(
    provider_name="notion-oauth-provider",
    scopes=[],  # Notion uses page picker instead of scopes
)


# ── Notion API Callers ─────────────────────────────────────────────────

# Shared HTTP client for connection pooling
_http_client: Optional[httpx.AsyncClient] = None


async def _get_http_client() -> httpx.AsyncClient:
    """Get or create shared HTTP client for connection reuse."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


def _get_headers(access_token: str) -> Dict[str, str]:
    """Get standard Notion API headers."""
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
    }


async def call_notion_api_get(
    access_token: str, endpoint: str, params: Optional[Dict] = None
) -> Dict:
    """Notion REST API GET caller."""
    url = f"{NOTION_API_BASE}/{endpoint}"
    headers = _get_headers(access_token)

    client = await _get_http_client()
    response = await client.get(url, headers=headers, params=params)
    response.raise_for_status()
    return response.json()


async def call_notion_api_post(
    access_token: str, endpoint: str, data: Optional[Dict] = None
) -> Dict:
    """Notion REST API POST caller."""
    url = f"{NOTION_API_BASE}/{endpoint}"
    headers = _get_headers(access_token)

    client = await _get_http_client()
    response = await client.post(url, headers=headers, json=data or {})
    response.raise_for_status()
    return response.json()


async def call_notion_api_patch(
    access_token: str, endpoint: str, data: Optional[Dict] = None
) -> Dict:
    """Notion REST API PATCH caller."""
    url = f"{NOTION_API_BASE}/{endpoint}"
    headers = _get_headers(access_token)

    client = await _get_http_client()
    response = await client.patch(url, headers=headers, json=data or {})
    response.raise_for_status()
    return response.json()


# ── Helper Functions ─────────────────────────────────────────────────


def _extract_title(properties: Dict) -> str:
    """Extract title from page/database properties."""
    # Try common title property names
    for key in ["title", "Title", "Name", "name"]:
        if key in properties:
            prop = properties[key]
            if prop.get("type") == "title":
                title_array = prop.get("title", [])
                if title_array:
                    return "".join(t.get("plain_text", "") for t in title_array)
    return "(Untitled)"


def _format_page_response(page: Dict) -> Dict:
    """Format page data for response."""
    properties = page.get("properties", {})
    return {
        "id": page.get("id", ""),
        "object": page.get("object", ""),
        "title": _extract_title(properties),
        "url": page.get("url", ""),
        "created_time": page.get("created_time", ""),
        "last_edited_time": page.get("last_edited_time", ""),
        "archived": page.get("archived", False),
        "parent": page.get("parent", {}),
        "properties": properties,
    }


def _format_database_response(database: Dict) -> Dict:
    """Format database data for response."""
    title = database.get("title", [])
    title_text = "".join(t.get("plain_text", "") for t in title) if title else "(Untitled)"

    return {
        "id": database.get("id", ""),
        "object": database.get("object", ""),
        "title": title_text,
        "url": database.get("url", ""),
        "created_time": database.get("created_time", ""),
        "last_edited_time": database.get("last_edited_time", ""),
        "properties": {k: {"type": v.get("type")} for k, v in database.get("properties", {}).items()},
    }


def _format_block_response(block: Dict) -> Dict:
    """Format block data for response."""
    block_type = block.get("type", "")
    content = block.get(block_type, {})

    # Extract text content if available
    text = ""
    if "rich_text" in content:
        text = "".join(t.get("plain_text", "") for t in content.get("rich_text", []))
    elif "text" in content:
        text = "".join(t.get("plain_text", "") for t in content.get("text", []))

    return {
        "id": block.get("id", ""),
        "type": block_type,
        "text": text,
        "has_children": block.get("has_children", False),
        "content": content,
    }


def _build_rich_text(text: str) -> List[Dict]:
    """Build rich text array from plain text."""
    return [{"type": "text", "text": {"content": text}}]


# ── Tool Registration ───────────────────────────────────────────────────


def register_notion_tools(mcp):
    """Register Notion tools to a FastMCP instance.

    Args:
        mcp: FastMCP instance to register tools to
    """

    @mcp.tool()
    async def notion_search(
        query: str = "",
        filter_type: Optional[str] = None,
        page_size: int = 10,
        ctx: Context = None,
    ) -> str:
        """Search Notion pages and databases.

        Args:
            query: Search query text. Empty string returns all accessible pages.
            filter_type: Filter results by type: "page" or "database". Optional.
            page_size: Number of results (1-100, default 10).
        """
        page_size = max(1, min(100, page_size))

        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            body: Dict[str, Any] = {"page_size": page_size}
            if query:
                body["query"] = query
            if filter_type in ("page", "database"):
                body["filter"] = {"value": filter_type, "property": "object"}

            data = await call_notion_api_post(access_token, "search", body)

            results = []
            for item in data.get("results", []):
                if item.get("object") == "page":
                    results.append(_format_page_response(item))
                elif item.get("object") == "database":
                    results.append(_format_database_response(item))

            return json.dumps({
                "results": results,
                "total_count": len(results),
                "has_more": data.get("has_more", False),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error searching Notion: {e}")
            return f"Error searching Notion: {str(e)}"

    @mcp.tool()
    async def notion_list_databases(page_size: int = 10, ctx: Context = None) -> str:
        """List all accessible Notion databases.

        Args:
            page_size: Number of results (1-100, default 10).
        """
        page_size = max(1, min(100, page_size))

        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            body = {
                "filter": {"value": "database", "property": "object"},
                "page_size": page_size,
            }

            data = await call_notion_api_post(access_token, "search", body)

            databases = [_format_database_response(db) for db in data.get("results", [])]

            return json.dumps({
                "databases": databases,
                "total_count": len(databases),
                "has_more": data.get("has_more", False),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error listing databases: {e}")
            return f"Error listing databases: {str(e)}"

    @mcp.tool()
    async def notion_query_database(
        database_id: str,
        filter_json: Optional[str] = None,
        sorts_json: Optional[str] = None,
        page_size: int = 10,
        ctx: Context = None,
    ) -> str:
        """Query a Notion database with optional filters and sorts.

        IMPORTANT: filter_json and sorts_json must be plain JSON strings, NOT parsed objects or arrays.
        Pass them as a single escaped string value, not as a JSON structure.

        Args:
            database_id: The database ID to query.
            filter_json: A string containing JSON for the filter. Must be a string, not an object. Example: '{"property": "Status", "select": {"equals": "Done"}}'
            sorts_json: A string containing JSON for sorts. Must be a string, not an array. Example: '[{"property": "Created", "direction": "descending"}]'
            page_size: Number of results (1-100, default 10).

        Correct usage:
            filter_json = '{"property": "Status", "select": {"equals": "Done"}}'
            sorts_json = '[{"property": "Created", "direction": "descending"}]'

        Wrong usage (DO NOT pass as objects/arrays):
            filter_json = {"property": "Status", "select": {"equals": "Done"}}
            sorts_json = [{"property": "Created", "direction": "descending"}]
        """
        page_size = max(1, min(100, page_size))

        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            body: Dict[str, Any] = {"page_size": page_size}

            if filter_json:
                try:
                    body["filter"] = json.loads(filter_json)
                except json.JSONDecodeError:
                    return "Error: filter_json is not valid JSON"

            if sorts_json:
                try:
                    body["sorts"] = json.loads(sorts_json)
                except json.JSONDecodeError:
                    return "Error: sorts_json is not valid JSON"

            data = await call_notion_api_post(
                access_token,
                f"databases/{database_id}/query",
                body
            )

            pages = [_format_page_response(page) for page in data.get("results", [])]

            return json.dumps({
                "database_id": database_id,
                "pages": pages,
                "total_count": len(pages),
                "has_more": data.get("has_more", False),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error querying database: {e}")
            return f"Error querying database: {str(e)}"

    @mcp.tool()
    async def notion_get_page(page_id: str, ctx: Context = None) -> str:
        """Get a Notion page's properties.

        Args:
            page_id: The page ID to retrieve.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            page = await call_notion_api_get(access_token, f"pages/{page_id}")

            return json.dumps(_format_page_response(page), ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error getting page: {e}")
            return f"Error getting page: {str(e)}"

    @mcp.tool()
    async def notion_create_page(
        parent_type: str,
        parent_id: str,
        title: str,
        properties_json: Optional[str] = None,
        content_markdown: Optional[str] = None,
        ctx: Context = None,
    ) -> str:
        """Create a new Notion page.

        Args:
            parent_type: Parent type - "database" or "page".
            parent_id: Parent database or page ID.
            title: Page title.
            properties_json: A string containing JSON for additional properties (for database pages). Must be a string, not an object. Example: '{"Status": {"select": {"name": "In Progress"}}}'. Optional.
            content_markdown: Initial page content as simple text/markdown. Optional.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            # Build parent
            if parent_type == "database":
                parent = {"database_id": parent_id}
                # For database pages, title goes in properties
                properties = {"title": {"title": _build_rich_text(title)}}
            else:
                parent = {"page_id": parent_id}
                properties = {"title": {"title": _build_rich_text(title)}}

            # Merge additional properties
            if properties_json:
                try:
                    extra_props = json.loads(properties_json)
                    properties.update(extra_props)
                except json.JSONDecodeError:
                    return "Error: properties_json is not valid JSON"

            body: Dict[str, Any] = {
                "parent": parent,
                "properties": properties,
            }

            # Add content as blocks
            if content_markdown:
                # Split by paragraphs and create paragraph blocks
                paragraphs = content_markdown.strip().split("\n\n")
                children = []
                for para in paragraphs:
                    if para.strip():
                        children.append({
                            "object": "block",
                            "type": "paragraph",
                            "paragraph": {
                                "rich_text": _build_rich_text(para.strip())
                            }
                        })
                if children:
                    body["children"] = children

            page = await call_notion_api_post(access_token, "pages", body)

            return json.dumps({
                "success": True,
                "message": "Page created successfully",
                "page": _format_page_response(page),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error creating page: {e}")
            return f"Error creating page: {str(e)}"

    @mcp.tool()
    async def notion_update_page(
        page_id: str,
        properties_json: str,
        archived: Optional[bool] = None,
        ctx: Context = None,
    ) -> str:
        """Update a Notion page's properties.

        Args:
            page_id: The page ID to update.
            properties_json: A string containing JSON for properties to update. Must be a string, not an object. Example: '{"Status": {"select": {"name": "Done"}}}'
            archived: Set to True to archive, False to unarchive. Optional.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            try:
                properties = json.loads(properties_json)
            except json.JSONDecodeError:
                return "Error: properties_json is not valid JSON"

            body: Dict[str, Any] = {"properties": properties}
            if archived is not None:
                body["archived"] = archived

            page = await call_notion_api_patch(access_token, f"pages/{page_id}", body)

            return json.dumps({
                "success": True,
                "message": "Page updated successfully",
                "page": _format_page_response(page),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error updating page: {e}")
            return f"Error updating page: {str(e)}"

    @mcp.tool()
    async def notion_get_block_children(
        block_id: str,
        page_size: int = 50,
        ctx: Context = None,
    ) -> str:
        """Get the content blocks of a page or block.

        Use page ID to get the page's content blocks.

        Args:
            block_id: The page or block ID to get children from.
            page_size: Number of blocks to retrieve (1-100, default 50).
        """
        page_size = max(1, min(100, page_size))

        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_notion_api_get(
                access_token,
                f"blocks/{block_id}/children",
                params={"page_size": page_size}
            )

            blocks = [_format_block_response(block) for block in data.get("results", [])]

            return json.dumps({
                "block_id": block_id,
                "blocks": blocks,
                "total_count": len(blocks),
                "has_more": data.get("has_more", False),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error getting block children: {e}")
            return f"Error getting block children: {str(e)}"

    @mcp.tool()
    async def notion_append_blocks(
        page_id: str,
        content_markdown: str,
        ctx: Context = None,
    ) -> str:
        """Append content blocks to a Notion page.

        Args:
            page_id: The page ID to append content to.
            content_markdown: Content to append as text/markdown.
                             Paragraphs separated by blank lines become separate blocks.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            # Split by paragraphs and create blocks
            paragraphs = content_markdown.strip().split("\n\n")
            children = []

            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                # Detect headings
                if para.startswith("### "):
                    children.append({
                        "object": "block",
                        "type": "heading_3",
                        "heading_3": {"rich_text": _build_rich_text(para[4:])}
                    })
                elif para.startswith("## "):
                    children.append({
                        "object": "block",
                        "type": "heading_2",
                        "heading_2": {"rich_text": _build_rich_text(para[3:])}
                    })
                elif para.startswith("# "):
                    children.append({
                        "object": "block",
                        "type": "heading_1",
                        "heading_1": {"rich_text": _build_rich_text(para[2:])}
                    })
                elif para.startswith("- ") or para.startswith("* "):
                    # Bulleted list items
                    items = para.split("\n")
                    for item in items:
                        item_text = item.lstrip("- *").strip()
                        if item_text:
                            children.append({
                                "object": "block",
                                "type": "bulleted_list_item",
                                "bulleted_list_item": {"rich_text": _build_rich_text(item_text)}
                            })
                elif para.startswith("1. ") or para.startswith("1) "):
                    # Numbered list items
                    items = para.split("\n")
                    for item in items:
                        item_text = item.lstrip("0123456789.)").strip()
                        if item_text:
                            children.append({
                                "object": "block",
                                "type": "numbered_list_item",
                                "numbered_list_item": {"rich_text": _build_rich_text(item_text)}
                            })
                elif para.startswith("```"):
                    # Code block
                    code_content = para.strip("`").strip()
                    children.append({
                        "object": "block",
                        "type": "code",
                        "code": {
                            "rich_text": _build_rich_text(code_content),
                            "language": "plain text"
                        }
                    })
                elif para.startswith("> "):
                    # Quote
                    children.append({
                        "object": "block",
                        "type": "quote",
                        "quote": {"rich_text": _build_rich_text(para[2:])}
                    })
                else:
                    # Regular paragraph
                    children.append({
                        "object": "block",
                        "type": "paragraph",
                        "paragraph": {"rich_text": _build_rich_text(para)}
                    })

            if not children:
                return json.dumps({
                    "success": False,
                    "message": "No content to append",
                }, ensure_ascii=False, indent=2)

            data = await call_notion_api_patch(
                access_token,
                f"blocks/{page_id}/children",
                {"children": children}
            )

            return json.dumps({
                "success": True,
                "message": f"Appended {len(children)} blocks to page",
                "blocks_added": len(children),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error appending blocks: {e}")
            return f"Error appending blocks: {str(e)}"

    logger.info("[Notion] Registered 8 Notion tools: notion_search, notion_list_databases, notion_query_database, notion_get_page, notion_create_page, notion_update_page, notion_get_block_children, notion_append_blocks")
