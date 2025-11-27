"""
Browser automation tools using AgentCore Browser + Nova Act.
Each tool returns a screenshot to show current browser state.
"""

import logging
from typing import Dict, Any, Optional
from strands import tool, ToolContext
from .lib.browser_controller import get_or_create_controller

logger = logging.getLogger(__name__)


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
            # Prepare response with screenshot (code interpreter format)
            content = [{
                "text": f"""✅ **Navigated successfully**

**URL**: {result.get('current_url', url)}
**Page Title**: {result.get('page_title', 'N/A')}

Current page is shown in the screenshot below."""
            }]

            # Add screenshot as image content (raw bytes, like code interpreter)
            if result.get("screenshot"):
                content.append({
                    "image": {
                        "format": "png",
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

        content = [{
            "text": f"""{status_emoji} **Action executed**

**Instruction**: {instruction}
**Result**: {result.get('message', 'Action completed')}
**Current URL**: {result.get('current_url', 'N/A')}
**Page Title**: {result.get('page_title', 'N/A')}

Current page state is shown in the screenshot below."""
        }]

        # Add screenshot as image content (raw bytes, like code interpreter)
        if result.get("screenshot"):
            content.append({
                "image": {
                    "format": "png",
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

    Args:
        description: ENGLISH description of what to extract from the page.
                    Example: "Extract product information including name, price, and rating"

        extraction_schema: JSON schema defining the exact structure of data to extract.
                Must include 'type', 'properties', and optionally 'required' fields.

    Schema Guidelines:
        - Use simple types: string, number, boolean, array, object
        - Add 'description' to each field to help AI understand
        - Mark important fields as 'required'
        - Keep structure flat when possible

    Example - Single product:
        description: "Extract the main product details"
        extraction_schema: {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Product name"},
                "price": {"type": "number", "description": "Current price in dollars"},
                "rating": {"type": "number", "description": "Average rating out of 5"}
            },
            "required": ["name", "price"]
        }

    Example - Multiple products:
        description: "Extract all products shown on the page"
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

            content = [{
                "text": f"""✅ **Data extracted successfully**

**Description**: {description}

**Schema**:
```json
{schema_str}
```

**Current URL**: {result.get('current_url', 'N/A')}
**Page Title**: {result.get('page_title', 'N/A')}

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
    - Interactive elements: Visible buttons, links, input fields (top 10 each)
    - Content structure: Headings, images, forms, tables
    - State indicators: Alerts, modals, loading states
    - Navigation: Breadcrumbs, history

    Use cases:
    - Quick situation assessment: "What can I do on this page?"
    - Debugging: "Why isn't the button appearing?"
    - State checking: "Is there a loading indicator?"
    - Form discovery: "What inputs are available?"

    Performance: < 300ms (no AI inference, direct DOM access)

    Returns structured JSON (no screenshot).
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
