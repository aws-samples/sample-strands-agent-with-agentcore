"""
Excalidraw Diagram Tool
Creates hand-drawn style diagrams by generating Excalidraw element JSON.
No external dependencies required - the LLM generates the diagram JSON directly.
"""

import json
import logging
from typing import Any
from strands import tool
from skill import skill

logger = logging.getLogger(__name__)


@skill("excalidraw")
@tool
def create_excalidraw_diagram(
    elements: list[dict[str, Any]],
    title: str = "Diagram",
    background_color: str = "#ffffff"
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

        return json.dumps({
            "success": True,
            "excalidraw_data": excalidraw_data,
            "message": f"Created diagram '{title}' with {element_count} elements"
        })

    except Exception as e:
        logger.error(f"Error creating Excalidraw diagram: {e}")
        return json.dumps({"success": False, "error": str(e)})
