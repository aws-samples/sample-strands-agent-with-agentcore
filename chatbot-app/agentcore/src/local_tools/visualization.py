"""
Simple Visualization Tool - Strands Native
Creates chart specifications for frontend rendering without external dependencies
"""

import json
import logging
from typing import Any, Literal
from strands import tool

logger = logging.getLogger(__name__)


def validate_chart_data(chart_type: str, data: list[dict[str, Any]]) -> tuple[bool, str | None]:
    """Validate chart data structure"""
    if not data:
        return False, "Data array is empty"

    if chart_type == "pie":
        # Pie charts need segment/value pairs
        for item in data:
            if "segment" not in item or "value" not in item:
                # Try to find alternative field names
                if not any(k in item for k in ["name", "label", "category"]):
                    return False, "Pie chart data must have 'segment' (or 'name'/'label') field"
                if not any(k in item for k in ["value", "count", "amount"]):
                    return False, "Pie chart data must have 'value' (or 'count'/'amount') field"

    elif chart_type in ["bar", "line"]:
        # Bar/line charts need x/y pairs
        for item in data:
            if "x" not in item or "y" not in item:
                return False, f"{chart_type.title()} chart data must have 'x' and 'y' fields"

    return True, None


def normalize_chart_data(chart_type: str, data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize chart data to standard format"""
    normalized = []

    for item in data:
        normalized_item = dict(item)

        if chart_type == "pie":
            # Normalize segment field
            if "segment" not in normalized_item:
                for alt_name in ["name", "label", "category", "key"]:
                    if alt_name in normalized_item:
                        normalized_item["segment"] = normalized_item[alt_name]
                        break

            # Normalize value field
            if "value" not in normalized_item:
                for alt_name in ["count", "amount", "total", "size"]:
                    if alt_name in normalized_item:
                        normalized_item["value"] = normalized_item[alt_name]
                        break

        normalized.append(normalized_item)

    return normalized


def _generate_chart_config(data: list[dict[str, Any]], chart_type: str) -> dict:
    """Generate chartConfig for recharts with custom colors if provided"""
    config = {}

    # Default color palette
    default_colors = [
        "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
        "hsl(var(--chart-4))", "hsl(var(--chart-5))"
    ]

    if chart_type == "pie":
        # For pie charts, use segment values and custom colors if provided
        for idx, item in enumerate(data):
            if "segment" in item:
                segment = item["segment"]
                # Use custom color if provided, otherwise use default palette
                color = item.get("color", default_colors[idx % len(default_colors)])
                config[segment] = {
                    "label": segment,
                    "color": color
                }
    else:
        # For bar/line charts, check if data items have custom colors
        if data and "y" in data[0]:
            # Check if any item has a color field
            has_custom_colors = any("color" in item for item in data)

            if has_custom_colors:
                # If colors are provided per data point, use those
                # Note: recharts will use these from the data directly
                config["y"] = {
                    "label": "Value",
                    "color": "hsl(var(--chart-1))"  # Default fallback
                }
            else:
                config["y"] = {
                    "label": "Value",
                    "color": "hsl(var(--chart-1))"
                }

    return config


@tool
def create_visualization(
    chart_type: Literal["bar", "line", "pie"],
    data: list[dict[str, Any]],
    title: str = "",
    x_label: str = "",
    y_label: str = ""
) -> str:
    """
    Create interactive chart visualizations (bar, line, pie) from data.

    Args:
        chart_type: "bar", "line", or "pie"
        data: Array of data objects
            - Bar/line: [{"x": value, "y": value}, ...]
            - Pie: [{"segment": name, "value": number}, ...]
            - Optional color: "color": "hsl(210, 100%, 50%)"
        title: Chart title (optional)
        x_label: X-axis label (optional)
        y_label: Y-axis label (optional)

    Returns:
        Chart specification for frontend rendering
    """
    try:
        # Validate input
        if chart_type not in ["bar", "line", "pie"]:
            error_dict = {
                "success": False,
                "error": f"Invalid chart type: {chart_type}. Must be 'bar', 'line', or 'pie'"
            }
            return json.dumps(error_dict)

        # Validate data structure
        is_valid, error_msg = validate_chart_data(chart_type, data)
        if not is_valid:
            error_dict = {
                "success": False,
                "error": error_msg,
                "chart_type": chart_type
            }
            return json.dumps(error_dict)

        # Normalize data
        normalized_data = normalize_chart_data(chart_type, data)

        # Generate chart config for recharts
        chart_config = _generate_chart_config(normalized_data, chart_type)

        # Create chart data in frontend format
        chart_data = {
            "chartType": chart_type,
            "config": {
                "title": title,
                "description": f"{chart_type.title()} chart with {len(normalized_data)} data points",
                "xAxisKey": "x" if chart_type in ["bar", "line"] else None,
            },
            "data": normalized_data,
            "chartConfig": chart_config
        }

        logger.info(f"Created {chart_type} chart with {len(normalized_data)} data points")

        # Return as JSON string
        result_dict = {
            "success": True,
            "chart_data": chart_data,
            "message": f"Created {chart_type} chart '{title}' with {len(normalized_data)} data points"
        }

        return json.dumps(result_dict)

    except Exception as e:
        logger.error(f"Error creating visualization: {e}")
        error_dict = {
            "success": False,
            "error": str(e),
            "chart_type": chart_type
        }
        return json.dumps(error_dict)
