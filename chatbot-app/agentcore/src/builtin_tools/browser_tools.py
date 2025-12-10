"""
Browser automation tools using AgentCore Browser + Nova Act.
Each tool returns a screenshot to show current browser state.
"""

import logging
from typing import Dict, Any, Optional, List
from strands import tool, ToolContext
from .lib.browser_controller import get_or_create_controller

logger = logging.getLogger(__name__)


def _format_tab_summary(tabs: List[Dict], current_tab: int = 0) -> str:
    """Format tab list as a compact summary string.

    Args:
        tabs: List of tab info dicts with 'index', 'title', 'is_current'
        current_tab: Current tab index (fallback if is_current not in tabs)

    Returns:
        Formatted string like: "**Tabs** (3): [0] Google | [1] Amazon <- | [2] GitHub"
        Returns empty string if only one tab.
    """
    if not tabs or len(tabs) <= 1:
        return ""

    tab_parts = []
    for tab in tabs:
        title = tab.get('title', 'Untitled')[:20]  # Truncate long titles
        is_current = tab.get('is_current', tab['index'] == current_tab)
        marker = " <-" if is_current else ""
        tab_parts.append(f"[{tab['index']}] {title}{marker}")

    return f"**Tabs** ({len(tabs)}): " + " | ".join(tab_parts)


def _format_tab_list_detailed(tabs: List[Dict]) -> str:
    """Format tab list with full details for get_page_info.

    Args:
        tabs: List of tab info dicts

    Returns:
        Formatted multi-line string with full tab details
    """
    if not tabs:
        return "No tabs open"

    lines = [f"**All Tabs** ({len(tabs)}):"]
    for tab in tabs:
        title = tab.get('title', 'Untitled')[:50]
        url = tab.get('url', 'about:blank')
        marker = "  <- current" if tab.get('is_current') else ""
        lines.append(f"  [{tab['index']}] {title}{marker}")
        lines.append(f"      {url}")

    return "\n".join(lines)


@tool(context=True)
def browser_navigate(url: str, tool_context: ToolContext) -> Dict[str, Any]:
    """
    Navigate browser to a URL and capture the loaded page with screenshot.

    CRITICAL: Use direct URLs with search parameters whenever possible.

    Args:
        url: Complete URL with search parameters

    Common Search URL Patterns:
        Google:  https://www.google.com/search?q={query}
        Amazon:  https://www.amazon.com/s?k={product}
        YouTube: https://www.youtube.com/results?search_query={video}
        GitHub:  https://github.com/search?q={repo}

    Example - User asks "search for python tutorials on Google":
        ✓ CORRECT: browser_navigate("https://www.google.com/search?q=python+tutorials")
        ✗ WRONG:   browser_navigate("https://google.com") then browser_act("type python tutorials and search")

    Returns screenshot showing the loaded page.
    """
    try:
        # Get session_id from ToolContext to avoid race condition with os.environ
        # Try invocation_state first, then agent's session_manager
        session_id = tool_context.invocation_state.get("session_id")
        if not session_id and hasattr(tool_context.agent, '_session_manager'):
            session_id = tool_context.agent._session_manager.session_id
            logger.info(f"[browser_navigate] Using session_id from agent._session_manager: {session_id}")
        elif session_id:
            logger.info(f"[browser_navigate] Using session_id from invocation_state: {session_id}")
        else:
            raise ValueError("session_id not found in ToolContext")

        controller = get_or_create_controller(session_id)
        result = controller.navigate(url)

        if result["status"] == "success":
            # Format tab summary if multiple tabs
            tab_summary = _format_tab_summary(
                result.get('tabs', []),
                result.get('current_tab', 0)
            )
            tab_line = f"\n{tab_summary}" if tab_summary else ""

            # Prepare response with screenshot (code interpreter format)
            content = [{
                "text": f"""✅ **Navigated successfully**

**URL**: {result.get('current_url', url)}
**Page Title**: {result.get('page_title', 'N/A')}{tab_line}

Current page is shown in the screenshot below."""
            }]

            # Add screenshot as image content (raw bytes, like code interpreter)
            if result.get("screenshot"):
                content.append({
                    "image": {
                        "format": "jpeg",
                        "source": {
                            "bytes": result["screenshot"]  # Raw bytes
                        }
                    }
                })

            # Get browser session info for Live View
            # Note: URL generation moved to BFF for on-demand refresh capability
            metadata = {}
            if controller.browser_session_client and controller.browser_session_client.session_id:
                metadata["browserSessionId"] = controller.browser_session_client.session_id
                if controller.browser_id:
                    metadata["browserId"] = controller.browser_id

            return {
                "content": content,
                "status": "success",
                "metadata": metadata
            }
        else:
            return {
                "content": [{
                    "text": f"❌ **Navigation failed**\n\n{result.get('message', 'Unknown error')}"
                }],
                "status": "error"
            }

    except Exception as e:
        logger.error(f"browser_navigate failed: {e}")
        return {
            "content": [{
                "text": f"❌ **Navigation error**: {str(e)}"
            }],
            "status": "error"
        }


@tool(context=True)
def browser_act(instruction: str, tool_context: ToolContext) -> Dict[str, Any]:
    """
    Execute browser actions using natural language (AI-powered visual understanding).

    CRITICAL: Combine multiple steps into ONE instruction whenever possible.

    Args:
        instruction: ENGLISH instruction combining 2-4 actions when the sequence is clear.

    Multi-Step Strategy (DEFAULT - Use this):
        ✓ "Type 'laptop' in the search box and click the search button"
        ✓ "Scroll down to the products section and click the first item"
        ✓ "Fill in email field with 'test@example.com' and click submit"
        ✓ "Click the 'Load More' button and wait for items to appear"

    Single-Step Only When:
        - You need to SEE the page state before deciding next action
        - The page layout is completely unknown
        - You're exploring/discovering page structure

    Instructions MUST be in ENGLISH with clear element descriptions.

    Returns screenshot showing the result.
    """
    try:
        # Get session_id from ToolContext to avoid race condition with os.environ
        session_id = tool_context.invocation_state.get("session_id")
        if not session_id and hasattr(tool_context.agent, '_session_manager'):
            session_id = tool_context.agent._session_manager.session_id
            logger.info(f"[browser_act] Using session_id from agent._session_manager: {session_id}")
        elif session_id:
            logger.info(f"[browser_act] Using session_id from invocation_state: {session_id}")
        else:
            raise ValueError("session_id not found in ToolContext")

        controller = get_or_create_controller(session_id)
        result = controller.act(instruction)

        status_emoji = "✅" if result["status"] == "success" else "⚠️"

        # Format tab summary if multiple tabs
        tab_summary = _format_tab_summary(
            result.get('tabs', []),
            result.get('current_tab', 0)
        )
        tab_line = f"\n{tab_summary}" if tab_summary else ""

        content = [{
            "text": f"""{status_emoji} **Action executed**

**Instruction**: {instruction}
**Result**: {result.get('message', 'Action completed')}
**Current URL**: {result.get('current_url', 'N/A')}
**Page Title**: {result.get('page_title', 'N/A')}{tab_line}

Current page state is shown in the screenshot below."""
        }]

        # Add screenshot as image content (raw bytes, like code interpreter)
        if result.get("screenshot"):
            content.append({
                "image": {
                    "format": "jpeg",
                    "source": {
                        "bytes": result["screenshot"]  # Raw bytes
                    }
                }
            })

        # Get browser session info for Live View
        metadata = {}
        if controller.browser_session_client and controller.browser_session_client.session_id:
            metadata["browserSessionId"] = controller.browser_session_client.session_id
            if controller.browser_id:
                metadata["browserId"] = controller.browser_id

        return {
            "content": content,
            "status": "success",  # Bedrock API requirement: only "success" or "error"
            "metadata": metadata
        }

    except Exception as e:
        logger.error(f"browser_act failed: {e}")
        return {
            "content": [{
                "text": f"❌ **Action error**: {str(e)}\n\n**Instruction**: {instruction}"
            }],
            "status": "error"
        }


@tool(context=True)
def browser_extract(description: str, extraction_schema: dict, tool_context: ToolContext) -> Dict[str, Any]:
    """
    Extract structured data from the current page using natural language + JSON schema.

    🔥 POWERFUL EXTRACTION: This tool can AUTOMATICALLY SCROLL through the entire page,
    click "Load More" buttons, navigate pagination, and collect ALL matching data across
    multiple screens in a SINGLE call. No need to manually scroll first!

    The AI will intelligently navigate the page to gather complete data that matches
    your schema, even if it spans multiple viewport screens or requires interaction.

    Args:
        description: ENGLISH description of what to extract from the page.
                    Be specific about scope:
                    - "Extract ALL products on this page" (will auto-scroll/paginate)
                    - "Extract the top 10 articles" (will collect limited set)
                    - "Extract complete product details" (will gather all fields)

        extraction_schema: JSON schema defining the exact structure of data to extract.
                Must include 'type', 'properties', and optionally 'required' fields.

    Schema Guidelines:
        - Use simple types: string, number, boolean, array, object
        - Add 'description' to each field to help AI understand
        - Mark important fields as 'required'
        - Keep structure flat when possible
        - Use 'array' type for collecting multiple items

    Example - Extract ALL products (auto-scrolls entire page):
        description: "Extract all products shown on this page, scrolling to collect everything"
        extraction_schema: {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Product title"},
                    "price": {"type": "number", "description": "Product price"},
                    "url": {"type": "string", "description": "Product page URL"}
                }
            }
        }

    Example - Single product details:
        description: "Extract the main product details from this product page"
        extraction_schema: {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Product name"},
                "price": {"type": "number", "description": "Current price in dollars"},
                "rating": {"type": "number", "description": "Average rating out of 5"},
                "reviews": {"type": "array", "items": {"type": "string"}, "description": "Customer reviews"}
            },
            "required": ["name", "price"]
        }

    Performance: Can take 1-4 minutes for complex extractions with scrolling/pagination.
    Returns extracted data matching the provided schema (no screenshot).
    """
    try:
        # Get session_id from ToolContext to avoid race condition with os.environ
        session_id = tool_context.invocation_state.get("session_id")
        if not session_id and hasattr(tool_context.agent, '_session_manager'):
            session_id = tool_context.agent._session_manager.session_id
            logger.info(f"[browser_extract] Using session_id from agent._session_manager: {session_id}")
        elif session_id:
            logger.info(f"[browser_extract] Using session_id from invocation_state: {session_id}")
        else:
            raise ValueError("session_id not found in ToolContext")

        controller = get_or_create_controller(session_id)

        # Extract data using description and JSON schema
        result = controller.extract(description, schema=extraction_schema)

        if result["status"] == "success":
            import json
            extracted_data_str = json.dumps(result.get("data", {}), indent=2, ensure_ascii=False)
            schema_str = json.dumps(extraction_schema, indent=2, ensure_ascii=False)

            # Format tab summary if multiple tabs
            tab_summary = _format_tab_summary(
                result.get('tabs', []),
                result.get('current_tab', 0)
            )
            tab_line = f"\n{tab_summary}" if tab_summary else ""

            content = [{
                "text": f"""✅ **Data extracted successfully**

**Description**: {description}

**Schema**:
```json
{schema_str}
```

**Current URL**: {result.get('current_url', 'N/A')}
**Page Title**: {result.get('page_title', 'N/A')}{tab_line}

**Extracted Data**:
```json
{extracted_data_str}
```"""
            }]

            # Get browser session info for Live View
            # Note: URL generation moved to BFF for on-demand refresh capability
            metadata = {}
            if controller.browser_session_client and controller.browser_session_client.session_id:
                metadata["browserSessionId"] = controller.browser_session_client.session_id
                if controller.browser_id:
                    metadata["browserId"] = controller.browser_id

            return {
                "content": content,
                "status": "success",
                "metadata": metadata
            }
        else:
            import json
            schema_str = json.dumps(extraction_schema, indent=2, ensure_ascii=False)
            return {
                "content": [{
                    "text": f"❌ **Extraction failed**\n\n{result.get('message', 'Unknown error')}\n\n**Description**: {description}\n\n**Schema**:\n```json\n{schema_str}\n```"
                }],
                "status": "error"
            }

    except Exception as e:
        import json
        logger.error(f"browser_extract failed: {e}")
        schema_str = json.dumps(extraction_schema, indent=2, ensure_ascii=False)
        return {
            "content": [{
                "text": f"❌ **Extraction error**: {str(e)}\n\n**Description**: {description}\n\n**Schema**:\n```json\n{schema_str}\n```"
            }],
            "status": "error"
        }


@tool(context=True)
def browser_get_page_info(tool_context: ToolContext) -> Dict[str, Any]:
    """
    Get structured information about the current page state - FAST, no AI needed.

    Returns comprehensive page information including:
    - Page context: URL, title, scroll position
    - All open tabs: Full list with URLs, titles, and current tab indicator
    - Interactive elements: Visible buttons, links, input fields (top 10 each)
    - Content structure: Headings, images, forms, tables
    - State indicators: Alerts, modals, loading states
    - Navigation: Breadcrumbs, history

    Use cases:
    - Quick situation assessment: "What can I do on this page?"
    - Check all open tabs: "What tabs are open?" "Which tab am I on?"
    - Debugging: "Why isn't the button appearing?"
    - State checking: "Is there a loading indicator?"
    - Form discovery: "What inputs are available?"

    Performance: < 300ms (no AI inference, direct DOM access)

    Returns structured JSON with all tab information (no screenshot).
    """
    try:
        # Get session_id from ToolContext
        session_id = tool_context.invocation_state.get("session_id")
        if not session_id and hasattr(tool_context.agent, '_session_manager'):
            session_id = tool_context.agent._session_manager.session_id
            logger.info(f"[browser_get_page_info] Using session_id from agent._session_manager: {session_id}")
        elif session_id:
            logger.info(f"[browser_get_page_info] Using session_id from invocation_state: {session_id}")
        else:
            raise ValueError("session_id not found in ToolContext")

        controller = get_or_create_controller(session_id)
        result = controller.get_page_info()

        if result["status"] == "success":
            import json

            # Format the structured data
            page_data = {
                "page": result["page"],
                "interactive": result["interactive"],
                "content": result["content"],
                "state": result["state"],
                "navigation": result["navigation"]
            }

            page_data_str = json.dumps(page_data, indent=2, ensure_ascii=False)

            # Build summary text
            page = result["page"]
            interactive = result["interactive"]
            content = result["content"]
            state = result["state"]

            summary_lines = []
            summary_lines.append(f"**URL**: {page['url']}")
            summary_lines.append(f"**Title**: {page['title']}")
            summary_lines.append(f"**Scroll**: {page['scroll']['percentage']}% ({page['scroll']['current']}/{page['scroll']['max']}px)")
            summary_lines.append("")

            # Interactive summary
            summary_lines.append(f"**Interactive Elements**:")
            summary_lines.append(f"- Buttons: {len(interactive['buttons'])} visible")
            summary_lines.append(f"- Links: {len(interactive['links'])} visible")
            summary_lines.append(f"- Inputs: {len(interactive['inputs'])} fields")
            summary_lines.append("")

            # Content summary
            summary_lines.append(f"**Content**:")
            summary_lines.append(f"- Headings: {len(content['headings'])}")
            summary_lines.append(f"- Images: {content['image_count']}")
            summary_lines.append(f"- Has form: {'Yes' if content['has_form'] else 'No'}")
            summary_lines.append(f"- Has table: {'Yes' if content['has_table'] else 'No'}")

            # State warnings
            if state['has_alerts']:
                summary_lines.append("")
                summary_lines.append(f"⚠️ **Alerts detected**: {len(state['alert_messages'])}")
            if state['has_modals']:
                summary_lines.append(f"⚠️ **Modal is open**")
            if state['has_loading']:
                summary_lines.append(f"⏳ **Page is loading**")

            # Add detailed tab information
            tabs = result.get('tabs', [])
            if tabs:
                summary_lines.append("")
                tab_details = _format_tab_list_detailed(tabs)
                summary_lines.append(tab_details)

            summary = "\n".join(summary_lines)

            content = [{
                "text": f"""✅ **Page information collected**

{summary}

**Full Details**:
```json
{page_data_str}
```"""
            }]

            # Get browser session info for Live View
            # Note: URL generation moved to BFF for on-demand refresh capability
            metadata = {}
            if controller.browser_session_client and controller.browser_session_client.session_id:
                metadata["browserSessionId"] = controller.browser_session_client.session_id
                if controller.browser_id:
                    metadata["browserId"] = controller.browser_id

            return {
                "content": content,
                "status": "success",
                "metadata": metadata
            }
        else:
            return {
                "content": [{
                    "text": f"❌ **Failed to get page info**\n\n{result.get('message', 'Unknown error')}"
                }],
                "status": "error"
            }

    except Exception as e:
        logger.error(f"browser_get_page_info failed: {e}")
        return {
            "content": [{
                "text": f"❌ **Error getting page info**: {str(e)}"
            }],
            "status": "error"
        }


@tool(context=True)
def browser_manage_tabs(
    action: str,
    tab_index: Optional[int] = None,
    url: Optional[str] = None,
    tool_context: ToolContext = None
) -> Dict[str, Any]:
    """
    Manage browser tabs - switch between tabs, close a tab, or create a new tab.

    NOTE: To VIEW all open tabs, use browser_get_page_info() instead.
    This tool is for ACTIONS only (switch/close/create).

    Args:
        action: Action to perform on tabs
            - "switch": Switch to the tab at tab_index (makes it the active tab)
            - "close": Close the tab at tab_index
            - "create": Create a new tab and navigate to url

        tab_index: Tab index (0-based). Required for "switch" and "close" actions.
                   Use -1 for the last tab. Ignored for "create" action.

        url: URL to open in new tab. Required for "create" action.
             If not provided for "create", opens about:blank.

    Examples:
        - Switch to first tab: browser_manage_tabs(action="switch", tab_index=0)
        - Switch to last tab: browser_manage_tabs(action="switch", tab_index=-1)
        - Close second tab: browser_manage_tabs(action="close", tab_index=1)
        - Create new tab: browser_manage_tabs(action="create", url="https://google.com")

    Returns screenshot of the current active tab after the action.
    """
    try:
        # Get session_id from ToolContext
        session_id = tool_context.invocation_state.get("session_id")
        if not session_id and hasattr(tool_context.agent, '_session_manager'):
            session_id = tool_context.agent._session_manager.session_id
            logger.info(f"[browser_manage_tabs] Using session_id from agent._session_manager: {session_id}")
        elif session_id:
            logger.info(f"[browser_manage_tabs] Using session_id from invocation_state: {session_id}")
        else:
            raise ValueError("session_id not found in ToolContext")

        controller = get_or_create_controller(session_id)

        # Validate action
        valid_actions = ["switch", "close", "create"]
        if action not in valid_actions:
            return {
                "content": [{
                    "text": f"❌ **Invalid action**: '{action}'. Must be one of: {', '.join(valid_actions)}\n\n💡 **Tip**: To view all tabs, use browser_get_page_info() instead."
                }],
                "status": "error"
            }

        # Handle each action
        if action == "switch":
            if tab_index is None:
                return {
                    "content": [{
                        "text": "❌ **tab_index required** for 'switch' action. Example: browser_manage_tabs(action='switch', tab_index=0)"
                    }],
                    "status": "error"
                }

            result = controller.switch_tab(tab_index)

            if result["status"] == "success":
                tab_details = _format_tab_list_detailed(result.get('tabs', []))

                content = [{
                    "text": f"""✅ **Switched to tab {result.get('current_tab', tab_index)}**

**URL**: {result.get('current_url', 'N/A')}
**Title**: {result.get('page_title', 'N/A')}

{tab_details}

Current tab screenshot shown below."""
                }]

                if result.get("screenshot"):
                    content.append({
                        "image": {
                            "format": "jpeg",
                            "source": {"bytes": result["screenshot"]}
                        }
                    })

                metadata = {}
                if controller.browser_session_client and controller.browser_session_client.session_id:
                    metadata["browserSessionId"] = controller.browser_session_client.session_id
                    if controller.browser_id:
                        metadata["browserId"] = controller.browser_id

                return {
                    "content": content,
                    "status": "success",
                    "metadata": metadata
                }
            else:
                return {
                    "content": [{
                        "text": f"❌ **Switch failed**: {result.get('message', 'Unknown error')}"
                    }],
                    "status": "error"
                }

        elif action == "close":
            if tab_index is None:
                return {
                    "content": [{
                        "text": "❌ **tab_index required** for 'close' action. Example: browser_manage_tabs(action='close', tab_index=1)"
                    }],
                    "status": "error"
                }

            result = controller.close_tab(tab_index)

            if result["status"] == "success":
                tab_details = _format_tab_list_detailed(result.get('tabs', []))

                content = [{
                    "text": f"""✅ **Tab closed**

{result.get('message', 'Tab closed successfully')}

**Now on tab {result.get('current_tab', 0)}**:
**URL**: {result.get('current_url', 'N/A')}
**Title**: {result.get('page_title', 'N/A')}

{tab_details}

Current tab screenshot shown below."""
                }]

                if result.get("screenshot"):
                    content.append({
                        "image": {
                            "format": "jpeg",
                            "source": {"bytes": result["screenshot"]}
                        }
                    })

                metadata = {}
                if controller.browser_session_client and controller.browser_session_client.session_id:
                    metadata["browserSessionId"] = controller.browser_session_client.session_id
                    if controller.browser_id:
                        metadata["browserId"] = controller.browser_id

                return {
                    "content": content,
                    "status": "success",
                    "metadata": metadata
                }
            else:
                return {
                    "content": [{
                        "text": f"❌ **Close failed**: {result.get('message', 'Unknown error')}"
                    }],
                    "status": "error"
                }

        elif action == "create":
            # URL is optional, defaults to about:blank
            create_url = url or "about:blank"

            result = controller.create_tab(create_url)

            if result["status"] == "success":
                tab_details = _format_tab_list_detailed(result.get('tabs', []))

                content = [{
                    "text": f"""✅ **New tab created**

{result.get('message', 'Tab created successfully')}

**Now on tab {result.get('current_tab', 0)}**:
**URL**: {result.get('current_url', 'N/A')}
**Title**: {result.get('page_title', 'N/A')}

{tab_details}

Current tab screenshot shown below."""
                }]

                if result.get("screenshot"):
                    content.append({
                        "image": {
                            "format": "jpeg",
                            "source": {"bytes": result["screenshot"]}
                        }
                    })

                metadata = {}
                if controller.browser_session_client and controller.browser_session_client.session_id:
                    metadata["browserSessionId"] = controller.browser_session_client.session_id
                    if controller.browser_id:
                        metadata["browserId"] = controller.browser_id

                return {
                    "content": content,
                    "status": "success",
                    "metadata": metadata
                }
            else:
                return {
                    "content": [{
                        "text": f"❌ **Create failed**: {result.get('message', 'Unknown error')}"
                    }],
                    "status": "error"
                }

    except Exception as e:
        logger.error(f"browser_manage_tabs failed: {e}")
        return {
            "content": [{
                "text": f"❌ **Tab management error**: {str(e)}"
            }],
            "status": "error"
        }
