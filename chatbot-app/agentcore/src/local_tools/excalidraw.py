"""
Excalidraw Diagram Tool
Creates hand-drawn style diagrams by generating Excalidraw element JSON.
No external dependencies required - the LLM generates the diagram JSON directly.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any
from strands import tool, ToolContext
from skill import skill

logger = logging.getLogger(__name__)


def _save_excalidraw_artifact(
    tool_context: ToolContext,
    title: str,
    s3_key: str,
    s3_url: str,
    element_count: int,
    user_id: str,
    session_id: str,
) -> None:
    """Save Excalidraw diagram as artifact to agent.state for Canvas display."""
    try:
        artifact_id = f"excalidraw-{title}"
        artifacts = tool_context.agent.state.get("artifacts") or {}

        artifacts[artifact_id] = {
            "id": artifact_id,
            "type": "excalidraw",
            "title": title,
            "content": s3_url,
            "tool_name": "create_excalidraw_diagram",
            "metadata": {
                "filename": f"{title}.json",
                "s3_key": s3_key,
                "s3_url": s3_url,
                "element_count": element_count,
                "user_id": user_id,
                "session_id": session_id,
            },
            "created_at": artifacts.get(artifact_id, {}).get("created_at", datetime.now(timezone.utc).isoformat()),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        tool_context.agent.state.set("artifacts", artifacts)

        session_manager = tool_context.invocation_state.get("session_manager")
        if not session_manager and hasattr(tool_context.agent, "session_manager"):
            session_manager = tool_context.agent.session_manager

        if session_manager:
            session_manager.sync_agent(tool_context.agent)
            logger.info(f"Saved Excalidraw artifact: {artifact_id}")
        else:
            logger.warning(f"No session_manager found, Excalidraw artifact not persisted: {artifact_id}")

    except Exception as e:
        logger.error(f"Failed to save Excalidraw artifact: {e}")


@skill("excalidraw")
@tool(context=True)
def create_excalidraw_diagram(
    elements: list[dict[str, Any]],
    title: str = "Diagram",
    background_color: str = "#ffffff",
    tool_context: ToolContext = None
) -> str:
    """
    Create a hand-drawn style diagram using Excalidraw element JSON.

    Args:
        elements: Array of Excalidraw element objects. Each element must have at minimum:
                  - type: "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text" | "freedraw"
                  - x, y: Position coordinates
                  - width, height: Dimensions (not required for text/freedraw)
                  Common optional fields: strokeColor, backgroundColor, fillStyle, label
        title: Title for the diagram (shown in Canvas)
        background_color: Canvas background color (default: "#ffffff")

    Returns:
        JSON string with excalidraw_data for frontend rendering
    """
    try:
        if not isinstance(elements, list):
            return json.dumps({"success": False, "error": "elements must be an array"})

        if len(elements) == 0:
            return json.dumps({"success": False, "error": "elements array is empty"})

        # Separate pseudo-elements from drawable elements
        camera_update = None
        drawable_elements = []
        ids_to_delete = set()

        for el in elements:
            if not isinstance(el, dict):
                continue
            el_type = el.get("type")
            if el_type == "cameraUpdate":
                camera_update = el
            elif el_type == "delete":
                for id_str in el.get("ids", "").split(","):
                    ids_to_delete.add(id_str.strip())
            else:
                drawable_elements.append(el)

        # Apply deletes
        if ids_to_delete:
            drawable_elements = [e for e in drawable_elements if e.get("id") not in ids_to_delete]

        valid_types = {"rectangle", "ellipse", "diamond", "arrow", "line", "text", "freedraw", "image"}
        for i, el in enumerate(drawable_elements):
            el_type = el.get("type")
            if el_type not in valid_types:
                return json.dumps({
                    "success": False,
                    "error": f"Element {i} has invalid type '{el_type}'. Valid types: {sorted(valid_types)}"
                })

        app_state: dict = {
            "viewBackgroundColor": background_color,
            "currentItemFontFamily": 1,
        }
        if camera_update:
            app_state["cameraUpdate"] = {
                "width": camera_update.get("width"),
                "height": camera_update.get("height"),
                "x": camera_update.get("x", 0),
                "y": camera_update.get("y", 0),
            }

        excalidraw_data = {
            "elements": drawable_elements,
            "appState": app_state,
            "title": title,
        }

        element_count = len(drawable_elements)
        logger.info(f"Created Excalidraw diagram '{title}' with {element_count} elements")

        # Save JSON to S3 and persist to agent.state
        s3_key = None
        s3_url = None
        if tool_context is not None:
            try:
                from workspace import ImageManager
                user_id = tool_context.invocation_state.get("user_id", "default_user")
                session_id = tool_context.invocation_state.get("session_id", "default_session")
                image_manager = ImageManager(user_id, session_id)
                serialized = json.dumps(excalidraw_data, ensure_ascii=False).encode("utf-8")
                s3_info = image_manager.save_to_s3(
                    f"{title}.json",
                    serialized,
                    metadata={"source": "excalidraw_tool", "diagram_type": "excalidraw"},
                )
                s3_key = s3_info["s3_key"]
                s3_url = s3_info["s3_url"]
                _save_excalidraw_artifact(tool_context, title, s3_key, s3_url, element_count, user_id, session_id)
            except Exception as e:
                logger.warning(f"Failed to save Excalidraw to S3/state (non-fatal): {e}")

        return json.dumps({
            "success": True,
            "excalidraw_data": excalidraw_data,
            "s3_key": s3_key,
            "message": f"Created diagram '{title}' with {element_count} elements"
        })

    except Exception as e:
        logger.error(f"Error creating Excalidraw diagram: {e}")
        return json.dumps({"success": False, "error": str(e)})
