"""
Notion Tools for MCP Server

Provides Notion tools with per-user OAuth authentication.
These tools are registered to a shared FastMCP instance.

Tools:
- notion_search: Search pages and databases
- notion_fetch: Fetch page with full content as readable markdown (replaces get_page + get_block_children)
- notion_create_page: Create a new page
- notion_update_page: Update page properties
- notion_append_blocks: Add content to a page
"""
import asyncio
import json
import logging
import re
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
try:
    import httpx
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

except ImportError:
    pass


# ── Helper Functions ─────────────────────────────────────────────────


def _extract_title(properties: Dict) -> str:
    """Extract title from page/database properties."""
    for key in ["title", "Title", "Name", "name"]:
        if key in properties:
            prop = properties[key]
            if prop.get("type") == "title":
                title_array = prop.get("title", [])
                if title_array:
                    return "".join(t.get("plain_text", "") for t in title_array)
    return "(Untitled)"


def _format_page_summary(page: Dict) -> Dict:
    """Format page data as a compact summary (for search/query results)."""
    properties = page.get("properties", {})
    return {
        "id": page.get("id", ""),
        "title": _extract_title(properties),
        "url": page.get("url", ""),
        "last_edited_time": page.get("last_edited_time", ""),
        "parent": page.get("parent", {}),
        "properties": {k: {"type": v.get("type"), "value": _extract_property_value(v)}
                       for k, v in properties.items()},
    }


def _extract_property_value(prop: Dict) -> Any:
    """Extract a human-readable value from a Notion property."""
    prop_type = prop.get("type", "")
    if prop_type == "title":
        return "".join(t.get("plain_text", "") for t in prop.get("title", []))
    elif prop_type == "rich_text":
        return "".join(t.get("plain_text", "") for t in prop.get("rich_text", []))
    elif prop_type == "select":
        sel = prop.get("select")
        return sel.get("name") if sel else None
    elif prop_type == "multi_select":
        return [s.get("name") for s in prop.get("multi_select", [])]
    elif prop_type == "status":
        st = prop.get("status")
        return st.get("name") if st else None
    elif prop_type == "checkbox":
        return prop.get("checkbox")
    elif prop_type == "date":
        d = prop.get("date")
        return d.get("start") if d else None
    elif prop_type == "number":
        return prop.get("number")
    elif prop_type == "url":
        return prop.get("url")
    elif prop_type == "email":
        return prop.get("email")
    elif prop_type == "phone_number":
        return prop.get("phone_number")
    elif prop_type == "people":
        return [p.get("name") for p in prop.get("people", [])]
    elif prop_type == "relation":
        return [r.get("id") for r in prop.get("relation", [])]
    return None


def _format_database_summary(database: Dict) -> Dict:
    """Format database data as a compact summary."""
    title = database.get("title", [])
    title_text = "".join(t.get("plain_text", "") for t in title) if title else "(Untitled)"
    return {
        "id": database.get("id", ""),
        "title": title_text,
        "url": database.get("url", ""),
        "last_edited_time": database.get("last_edited_time", ""),
        "properties": {k: v.get("type") for k, v in database.get("properties", {}).items()},
    }


def _blocks_to_markdown(blocks: List[Dict], depth: int = 0, include_ids: bool = False) -> str:
    """Convert Notion block list to readable markdown text.

    Args:
        blocks: List of Notion block objects.
        depth: Indentation depth for nested blocks.
        include_ids: If True, appends block ID as a comment on each line.
    """
    lines = []
    indent = "  " * depth

    for block in blocks:
        block_type = block.get("type", "")
        block_id = block.get("id", "")
        content = block.get(block_type, {})

        # Extract plain text from rich_text
        rich_text = content.get("rich_text", content.get("text", []))
        text = "".join(t.get("plain_text", "") for t in rich_text)

        id_suffix = f"  <!-- id:{block_id} -->" if include_ids and block_id else ""

        if block_type == "heading_1":
            lines.append(f"{indent}# {text}{id_suffix}")
        elif block_type == "heading_2":
            lines.append(f"{indent}## {text}{id_suffix}")
        elif block_type == "heading_3":
            lines.append(f"{indent}### {text}{id_suffix}")
        elif block_type == "paragraph":
            lines.append(f"{indent}{text}{id_suffix}" if text else "")
        elif block_type == "bulleted_list_item":
            lines.append(f"{indent}- {text}{id_suffix}")
        elif block_type == "numbered_list_item":
            lines.append(f"{indent}1. {text}{id_suffix}")
        elif block_type == "to_do":
            checked = content.get("checked", False)
            box = "[x]" if checked else "[ ]"
            lines.append(f"{indent}- {box} {text}{id_suffix}")
        elif block_type == "code":
            language = content.get("language", "plain text")
            lines.append(f"```{language}{id_suffix}")
            lines.append(text)
            lines.append("```")
        elif block_type == "quote":
            lines.append(f"{indent}> {text}{id_suffix}")
        elif block_type == "callout":
            icon = content.get("icon", {}).get("emoji", "")
            lines.append(f"{indent}> {icon} {text}{id_suffix}".strip())
        elif block_type == "toggle":
            lines.append(f"{indent}**{text}**{id_suffix}")
        elif block_type == "divider":
            lines.append(f"---{id_suffix}")
        elif block_type in ("child_page", "child_database"):
            child_title = content.get("title", "")
            lines.append(f"{indent}- [{child_title}]{id_suffix}")
        elif block_type == "image":
            img_url = (content.get("external", {}).get("url")
                       or content.get("file", {}).get("url", ""))
            caption_texts = content.get("caption", [])
            caption = "".join(t.get("plain_text", "") for t in caption_texts)
            lines.append(f"{indent}![{caption or 'image'}]({img_url}){id_suffix}")
        elif block_type == "table_of_contents":
            lines.append(f"{indent}*[Table of Contents]*{id_suffix}")
        elif block_type == "breadcrumb":
            lines.append(f"{indent}*[Breadcrumb]*{id_suffix}")
        # Skip unsupported block types silently

    return "\n".join(lines)


def _parse_inline_markdown(text: str) -> List[Dict]:
    """Parse inline markdown to Notion rich_text array.

    Supports: **bold**, *italic*, `code`
    Falls back to plain text for unrecognized patterns.
    """
    if not any(marker in text for marker in ("**", "*", "`")):
        return [{"type": "text", "text": {"content": text}}]

    rich_text = []
    # Match bold (**...**), italic (*...*), inline code (`...`), or plain text
    pattern = r"\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+)"

    for match in re.finditer(pattern, text, re.DOTALL):
        if match.group(1) is not None:  # **bold**
            rich_text.append({
                "type": "text",
                "text": {"content": match.group(1)},
                "annotations": {"bold": True},
            })
        elif match.group(2) is not None:  # *italic*
            rich_text.append({
                "type": "text",
                "text": {"content": match.group(2)},
                "annotations": {"italic": True},
            })
        elif match.group(3) is not None:  # `code`
            rich_text.append({
                "type": "text",
                "text": {"content": match.group(3)},
                "annotations": {"code": True},
            })
        elif match.group(4) is not None:  # plain text
            content = match.group(4)
            if content:
                rich_text.append({"type": "text", "text": {"content": content}})

    return rich_text or [{"type": "text", "text": {"content": text}}]


def _build_rich_text(text: str) -> List[Dict]:
    """Build plain rich text array (no inline parsing)."""
    return [{"type": "text", "text": {"content": text}}]


def _markdown_to_blocks(content_markdown: str) -> List[Dict]:
    """Convert markdown text to Notion block array.

    Supports per-line parsing:
    - Headings: # / ## / ###
    - Bullets: - or *
    - Numbered lists: 1. or 1)
    - To-do: - [ ] / - [x]
    - Code blocks: ```lang ... ```
    - Quotes: >
    - Dividers: ---
    - Inline: **bold**, *italic*, `code`
    """
    blocks = []
    lines = content_markdown.strip().split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]

        # Fenced code block
        if line.startswith("```"):
            lang_match = re.match(r"```(\w*)", line)
            language = (lang_match.group(1) if lang_match and lang_match.group(1)
                        else "plain text")
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code_lines.append(lines[i])
                i += 1
            blocks.append({
                "object": "block",
                "type": "code",
                "code": {
                    "rich_text": _build_rich_text("\n".join(code_lines)),
                    "language": language,
                },
            })

        # Headings
        elif line.startswith("### "):
            blocks.append({
                "object": "block",
                "type": "heading_3",
                "heading_3": {"rich_text": _parse_inline_markdown(line[4:])},
            })
        elif line.startswith("## "):
            blocks.append({
                "object": "block",
                "type": "heading_2",
                "heading_2": {"rich_text": _parse_inline_markdown(line[3:])},
            })
        elif line.startswith("# "):
            blocks.append({
                "object": "block",
                "type": "heading_1",
                "heading_1": {"rich_text": _parse_inline_markdown(line[2:])},
            })

        # Quote
        elif line.startswith("> "):
            blocks.append({
                "object": "block",
                "type": "quote",
                "quote": {"rich_text": _parse_inline_markdown(line[2:])},
            })

        # Divider
        elif re.match(r"^[-*_]{3,}$", line.strip()):
            blocks.append({"object": "block", "type": "divider", "divider": {}})

        # To-do checked: - [x] or * [x]
        elif re.match(r"^[-*]\s+\[x\]\s+", line, re.IGNORECASE):
            text = re.sub(r"^[-*]\s+\[x\]\s+", "", line, flags=re.IGNORECASE)
            blocks.append({
                "object": "block",
                "type": "to_do",
                "to_do": {
                    "rich_text": _parse_inline_markdown(text),
                    "checked": True,
                },
            })

        # To-do unchecked: - [ ]
        elif re.match(r"^[-*]\s+\[ \]\s+", line):
            text = re.sub(r"^[-*]\s+\[ \]\s+", "", line)
            blocks.append({
                "object": "block",
                "type": "to_do",
                "to_do": {
                    "rich_text": _parse_inline_markdown(text),
                    "checked": False,
                },
            })

        # Bulleted list
        elif re.match(r"^[-*]\s+", line):
            text = re.sub(r"^[-*]\s+", "", line)
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": _parse_inline_markdown(text)},
            })

        # Numbered list
        elif re.match(r"^\d+[.)]\s+", line):
            text = re.sub(r"^\d+[.)]\s+", "", line)
            blocks.append({
                "object": "block",
                "type": "numbered_list_item",
                "numbered_list_item": {"rich_text": _parse_inline_markdown(text)},
            })

        # Empty line — skip
        elif not line.strip():
            pass

        # Regular paragraph
        else:
            blocks.append({
                "object": "block",
                "type": "paragraph",
                "paragraph": {"rich_text": _parse_inline_markdown(line)},
            })

        i += 1

    return blocks


# ── Tool Registration ───────────────────────────────────────────────────


def register_notion_tools(mcp):
    """Register Notion tools to a FastMCP instance.

    Tools registered:
    - notion_search
    - notion_fetch
    - notion_create_page
    - notion_update_page
    - notion_update_block
    - notion_append_blocks
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
                    results.append(_format_page_summary(item))
                elif item.get("object") == "database":
                    results.append(_format_database_summary(item))

            return json.dumps({
                "results": results,
                "total_count": len(results),
                "has_more": data.get("has_more", False),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error searching Notion: {e}")
            return f"Error searching Notion: {str(e)}"

    @mcp.tool()
    async def notion_fetch(
        page_id: str,
        include_block_ids: bool = False,
        ctx: Context = None,
    ) -> str:
        """Fetch a Notion page with its full content as readable markdown.

        Retrieves page metadata and all content blocks in a single call,
        returning them as a formatted document. Use this to read any page
        or database entry.

        Args:
            page_id: The page ID to fetch (UUID format, with or without hyphens).
            include_block_ids: If True, appends each block's ID as a comment
                               (e.g. <!-- id:abc-123 -->) so you can target
                               specific blocks with notion_update_block. Default False.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            # Fetch page metadata and first batch of blocks concurrently
            page, blocks_data = await asyncio.gather(
                call_notion_api_get(access_token, f"pages/{page_id}"),
                call_notion_api_get(access_token, f"blocks/{page_id}/children",
                                    params={"page_size": 100}),
            )

            summary = _format_page_summary(page)
            title = summary["title"]
            url = summary["url"]
            last_edited = summary["last_edited_time"]

            blocks = blocks_data.get("results", [])
            has_more = blocks_data.get("has_more", False)

            content_md = _blocks_to_markdown(blocks, include_ids=include_block_ids)

            lines = [
                f"# {title}",
                f"",
                f"**URL**: {url}",
                f"**Last edited**: {last_edited}",
                f"",
                "---",
                "",
            ]
            lines.append(content_md if content_md else "*(empty page)*")

            if has_more:
                lines.append("\n\n*(content truncated — page has additional blocks)*")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"[Tool] Error fetching page: {e}")
            return f"Error fetching page: {str(e)}"

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
            parent_type: Parent type - "database", "page", or "workspace".
                         Use "workspace" to create a top-level page in the workspace root
                         (parent_id is ignored in this case).
            parent_id: Parent database or page ID (UUID). Ignored when parent_type is "workspace".
            title: Page title.
            properties_json: Additional properties as a JSON string (for database pages).
                             Example: '{"Status": {"select": {"name": "In Progress"}}}'
            content_markdown: Initial page content as markdown.
                              Supports: # headings, - bullets, 1. numbered, - [ ] to-do,
                              ```code```, > quotes, **bold**, *italic*, `code`
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            if parent_type == "database":
                parent = {"database_id": parent_id}
            elif parent_type == "workspace":
                parent = {"type": "workspace", "workspace": True}
            else:
                parent = {"page_id": parent_id}

            properties: Dict[str, Any] = {"title": {"title": _build_rich_text(title)}}

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

            if content_markdown:
                children = _markdown_to_blocks(content_markdown)
                if children:
                    body["children"] = children

            page = await call_notion_api_post(access_token, "pages", body)

            return json.dumps({
                "success": True,
                "message": "Page created successfully",
                "id": page.get("id"),
                "url": page.get("url"),
                "title": title,
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

        Use notion_append_blocks to add/update page content (blocks).
        This tool only updates page properties (metadata, database fields).

        Args:
            page_id: The page ID to update.
            properties_json: Properties to update as a JSON string.
                             Example: '{"Status": {"select": {"name": "Done"}}}'
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
                "id": page.get("id"),
                "url": page.get("url"),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error updating page: {e}")
            return f"Error updating page: {str(e)}"

    @mcp.tool()
    async def notion_update_block(
        block_id: str,
        content_markdown: str,
        ctx: Context = None,
    ) -> str:
        """Replace the content of an existing Notion block.

        Use notion_fetch(include_block_ids=True) first to get the block IDs,
        then call this tool with the target block_id and new content.

        Only the first block produced by content_markdown is used (one call
        updates one block). To replace multiple blocks, call this tool once
        per block.

        Supported block types to update: paragraph, heading_1/2/3,
        bulleted_list_item, numbered_list_item, to_do, quote, code.

        Args:
            block_id: The block ID to update (from notion_fetch with include_block_ids=True).
            content_markdown: New content as a single markdown line or block.
                              Example: "## New Heading" or "- [x] Completed task"
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            blocks = _markdown_to_blocks(content_markdown)
            if not blocks:
                return "Error: content_markdown produced no blocks"

            # Use only the first block
            new_block = blocks[0]
            block_type = new_block.get("type")
            block_content = new_block.get(block_type, {})

            data = await call_notion_api_patch(
                access_token,
                f"blocks/{block_id}",
                {block_type: block_content},
            )

            return json.dumps({
                "success": True,
                "message": f"Block updated successfully",
                "block_id": data.get("id"),
                "type": data.get("type"),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error updating block: {e}")
            return f"Error updating block: {str(e)}"

    @mcp.tool()
    async def notion_append_blocks(
        page_id: str,
        content_markdown: str,
        ctx: Context = None,
    ) -> str:
        """Append content blocks to a Notion page.

        Adds new content at the end of an existing page. Use this to
        update page body content (not properties — use notion_update_page for that).

        Args:
            page_id: The page ID to append content to.
            content_markdown: Content to append as markdown.
                              Supports: # headings, - bullets, 1. numbered, - [ ] to-do,
                              ```lang code```, > quotes, **bold**, *italic*, `code`
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _notion_oauth, "Notion")
            if access_token is None:
                return "Authorization was declined by the user."

            children = _markdown_to_blocks(content_markdown)

            if not children:
                return json.dumps({
                    "success": False,
                    "message": "No content to append",
                }, ensure_ascii=False, indent=2)

            await call_notion_api_patch(
                access_token,
                f"blocks/{page_id}/children",
                {"children": children},
            )

            return json.dumps({
                "success": True,
                "message": f"Appended {len(children)} blocks to page",
                "blocks_added": len(children),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error appending blocks: {e}")
            return f"Error appending blocks: {str(e)}"

    logger.info(
        "[Notion] Registered 6 tools: "
        "notion_search, notion_fetch, notion_create_page, "
        "notion_update_page, notion_update_block, notion_append_blocks"
    )
