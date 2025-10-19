"""
Visualization Tool

Creates and validates chart data for frontend rendering.
"""

import asyncio
import json
import os
import time
import logging
from typing import Any, Dict, List, Union
from strands import tool
from utils.tool_execution_context import get_current_session_id, get_current_tool_use_id, with_tool_context
from memory_store import get_memory_store
try:
    from routers.tool_events import tool_events_channel
    ANALYSIS_CHANNEL_AVAILABLE = tool_events_channel is not None
except ImportError:
    tool_events_channel = None
    ANALYSIS_CHANNEL_AVAILABLE = False

logger = logging.getLogger(__name__)

# Removed run_async helper as we're now using purely synchronous approach

def ensure_charts_directory():
    """Ensure the charts output directory exists."""
    charts_dir = "output/charts"
    os.makedirs(charts_dir, exist_ok=True)

def normalize_pie_chart_data(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Normalize pie chart data by converting common field names to 'segment' and 'value'.
    
    Args:
        data: List of data items for pie chart
        
    Returns:
        Normalized data with 'segment' and 'value' fields
    """
    segment_aliases = ['name', 'label', 'category', 'segment', 'key', 'type']
    value_aliases = ['value', 'count', 'amount', 'total', 'size', 'quantity', 'number']
    
    normalized_data = []
    
    for item in data:
        normalized_item = dict(item)  # Copy original item
        
        # Find and normalize segment field
        if 'segment' not in normalized_item:
            segment_found = False
            for alias in segment_aliases:
                if alias in normalized_item:
                    normalized_item['segment'] = normalized_item[alias]
                    segment_found = True
                    break
            
            if not segment_found:
                # Use first string field as segment
                for key, value in normalized_item.items():
                    if isinstance(value, str):
                        normalized_item['segment'] = value
                        break
        
        # Find and normalize value field
        if 'value' not in normalized_item:
            value_found = False
            for alias in value_aliases:
                if alias in normalized_item:
                    normalized_item['value'] = normalized_item[alias]
                    value_found = True
                    break
            
            if not value_found:
                # Use first numeric field as value
                for key, value in normalized_item.items():
                    if isinstance(value, (int, float)):
                        normalized_item['value'] = value
                        break
        
        normalized_data.append(normalized_item)
    
    return normalized_data

def validate_chart_schema(chart_data: Dict[str, Any]) -> None:
    """
    Validate the chart data schema.
    
    Args:
        chart_data: The chart data to validate
        
    Raises:
        ValueError: If the schema is invalid
    """
    # Required top-level fields
    required_fields = ["chartType", "config", "data", "chartConfig"]
    for field in required_fields:
        if field not in chart_data:
            raise ValueError(f"Missing required field: {field}")
    
    # Validate chartType
    valid_chart_types = ["line", "bar", "multiBar", "pie", "area", "stackedArea"]
    if chart_data["chartType"] not in valid_chart_types:
        raise ValueError(f"Invalid chartType. Must be one of: {', '.join(valid_chart_types)}")
    
    # Validate config structure
    config = chart_data["config"]
    required_config_fields = ["title", "description"]
    for field in required_config_fields:
        if field not in config:
            raise ValueError(f"Missing required config field: {field}")
    
    # Validate data is a list
    if not isinstance(chart_data["data"], list):
        raise ValueError("Data must be a list")
    
    if len(chart_data["data"]) == 0:
        raise ValueError("Data cannot be empty")
    
    # Validate chartConfig structure
    chart_config = chart_data["chartConfig"]
    if not isinstance(chart_config, dict):
        raise ValueError("chartConfig must be an object")
    
    # For non-pie charts, validate xAxisKey exists
    if chart_data["chartType"] != "pie":
        if "xAxisKey" not in config:
            raise ValueError("xAxisKey is required for non-pie charts")
        
        x_axis_key = config["xAxisKey"]
        # Check if xAxisKey exists in data
        if not all(x_axis_key in item for item in chart_data["data"]):
            raise ValueError(f"xAxisKey '{x_axis_key}' not found in all data items")
    
    # For pie charts, normalize data first
    if chart_data["chartType"] == "pie":
        chart_data["data"] = normalize_pie_chart_data(chart_data["data"])
        
        # Then validate required fields exist
        required_pie_fields = ["segment", "value"]
        for i, item in enumerate(chart_data["data"]):
            for field in required_pie_fields:
                if field not in item:
                    available_fields = list(item.keys())
                    raise ValueError(
                        f"Pie chart data item {i+1} must contain '{field}' field. "
                        f"Available fields: {available_fields}. "
                        f"Expected format: {{'segment': 'Category Name', 'value': 123}}"
                    )
            
            # Validate value is numeric
            if not isinstance(item['value'], (int, float)):
                raise ValueError(f"Pie chart 'value' field must be numeric, got {type(item['value']).__name__}")
    
    # Validate chartConfig has required label field
    for key, config_item in chart_config.items():
        if not isinstance(config_item, dict):
            raise ValueError(f"chartConfig['{key}'] must be an object")
        if "label" not in config_item:
            raise ValueError(f"chartConfig['{key}'] must have a 'label' field")
        # stacked field is optional boolean
        if "stacked" in config_item and not isinstance(config_item["stacked"], bool):
            raise ValueError(f"chartConfig['{key}'].stacked must be a boolean")
    
    # Validate trend data if present
    if "trend" in config and config["trend"]:
        trend = config["trend"]
        if "percentage" not in trend or "direction" not in trend:
            raise ValueError("Trend must have 'percentage' and 'direction' fields")
        if trend["direction"] not in ["up", "down"]:
            raise ValueError("Trend direction must be 'up' or 'down'")
        if not isinstance(trend["percentage"], (int, float)):
            raise ValueError("Trend percentage must be a number")

def save_chart_data(file_path: str, chart_data: Dict[str, Any]) -> None:
    """
    Save chart data to a JSON file.
    
    Args:
        file_path: Path to save the file
        chart_data: Chart data to save
    """
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(chart_data, f, indent=2, ensure_ascii=False)

@tool
@with_tool_context
async def create_visualization(chart_data: dict, chart_name: str) -> str:
    """
    Create interactive data visualizations with proper validation and formatting.
    
    Supports 6 chart types optimized for different data analysis needs:
    
    CHART TYPES & USE CASES:
    • line: Time series trends, performance tracking, numerical metrics over time
    • bar: Single metric comparisons, period analysis, category performance  
    • multiBar: Multiple metrics comparison, side-by-side analysis, cross-category insights
    • area: Volume/quantity over time, cumulative trends, market evolution
    • stackedArea: Component breakdowns over time, composition changes, market share
    • pie: Distribution analysis, market share breakdown, portfolio allocation
    
    BEST PRACTICES:
    • Use descriptive titles and clear descriptions
    • Include trend information (percentage & direction) when relevant
    • Add contextual footer notes for data sources/methodology
    • Structure data correctly based on chart type
    • Choose appropriate visualization for your data story
    
    Args:
        chart_data: Chart configuration with the following structure:
        
        For BAR/LINE/AREA charts:
        {
            "chartType": "bar|line|area|multiBar|stackedArea",
            "config": {
                "title": "Chart Title (required)",
                "description": "Chart description (required)",
                "xAxisKey": "category",  // REQUIRED: must match a field in your data
                "footer": "Data source info (optional)"
            },
            "data": [
                {"category": "Travel", "amount": 6800},
                {"category": "Dining", "amount": 3130}
            ],
            "chartConfig": {
                "amount": {"label": "Amount ($)"}
            }
        }
        
        For PIE charts:
        {
            "chartType": "pie",
            "config": {
                "title": "Chart Title (required)",
                "description": "Chart description (required)",
                "totalLabel": "Total (optional)"
            },
            "data": [
                {"segment": "Travel", "value": 6800},
                {"segment": "Dining", "value": 3130}
            ],
            "chartConfig": {
                "amount": {"label": "Amount ($)"}
            }
        }
        
        CRITICAL: Always include "xAxisKey" in config for non-pie charts, and ensure it matches a field name in your data array.
    
    Returns:
        JSON string with success status, chart ID, and validation results
    """
    logger.info("Creating visualization chart")
    
    try:
        # Debug: Check tool context state
        from utils.tool_execution_context import tool_context_manager
        current_context = tool_context_manager.get_current_context()
        if current_context:
            pass  # Context found, continue normally
        else:
            logger.warning("Visualization - No tool context found - this may cause session ID issues")
        
        # Use async approach with simplified progress tracking
        session_id = get_current_session_id()
        if not session_id:
            logger.error("❌ No session ID found in tool context - cannot send progress updates")
            # Don't generate random session ID - this causes cross-session leakage
            # Progress updates will be skipped if no session ID is available

        # Optional: Send progress if channel is available (non-blocking)
        if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel and session_id:
            try:
                await tool_events_channel.send_progress(
                    'visualization_tool',
                    session_id,
                    'processing',
                    f'Creating {chart_data.get("chartType", "chart")}...',
                    50,
                    {'executor': 'create_visualization'}
                )
            except Exception as e:
                logger.debug(f"Progress update failed (non-critical): {e}")
        
        # Validate the chart data schema
        validate_chart_schema(chart_data)
        
        # Use the provided chart_name as the chart_id
        chart_id = chart_name
        
        # Get tool use ID for memory storage
        tool_use_id = get_current_tool_use_id()
        if not tool_use_id:
            tool_use_id = f"tooluse_{chart_name}"

        # Store chart data in memory (only if session_id is available)
        if session_id:
            memory_store = get_memory_store()

            memory_store.store_chart(session_id, tool_use_id, chart_id, chart_data)

            # Verify storage immediately
            stored_chart = memory_store.get_chart(session_id, tool_use_id, chart_id)
            if not stored_chart:
                logger.error(f"Failed to store chart '{chart_name}' - verification failed")
        else:
            logger.warning("No session ID - chart will not be stored in memory")
        

        # Optional: Send completion progress
        if ANALYSIS_CHANNEL_AVAILABLE and tool_events_channel and session_id:
            try:
                await tool_events_channel.send_progress(
                    'visualization_tool',
                    session_id,
                    'completed',
                    'Chart created successfully!',
                    100,
                    {'executor': 'create_visualization'}
                )
            except Exception as e:
                logger.debug(f"Progress completion failed (non-critical): {e}")
        
        # Return JSON directly for frontend consumption (simplified approach)
        result_data = {
            "success": True,
            "chart_id": chart_id,
            "chart_type": chart_data["chartType"],
            "title": chart_data["config"]["title"],
            "message": f"Chart '{chart_data['config']['title']}' created successfully",
            "chart_data": chart_data
        }
        
        logger.info(f"Chart created successfully: {chart_id}")
        return json.dumps(result_data, indent=2)
        
    except ValueError as e:
        error_msg = str(e)
        logger.error(f"Chart validation error: {error_msg}")
        
        error_result = {
            "success": False,
            "message": f"❌ Chart creation failed: {error_msg}"
        }
        return json.dumps(error_result, indent=2)
        
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        logger.error(f"Chart creation error: {error_msg}")
        
        error_result = {
            "success": False,
            "message": f"❌ An error occurred while creating the chart: {str(e)}"
        }
        return json.dumps(error_result, indent=2)
