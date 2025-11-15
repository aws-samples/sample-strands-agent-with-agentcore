"""
Weather Tool

US Weather lookup tool using National Weather Service API.
Enhanced with progress reporting capabilities.
"""

import asyncio
import httpx
import logging
import uuid
from typing import Any, Dict, Optional
from strands import tool
from routers.tool_events import tool_events_channel

logger = logging.getLogger(__name__)

# Constants
NWS_API_BASE = "https://api.weather.gov"
USER_AGENT = "weather-app/1.0"

async def make_nws_request(url: str) -> Optional[Dict[str, Any]]:
    """Make a request to the NWS API with proper error handling."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/geo+json"
    }
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers, timeout=30.0)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"NWS API request failed: {e}")
            return None



@tool
async def get_current_weather(latitude: float, longitude: float, agent=None) -> dict:
    """
    Get current weather conditions for a US location using coordinates.
    
    Args:
        latitude: Latitude of the location (e.g., 40.7128 for NYC)
        longitude: Longitude of the location (e.g., -74.0060 for NYC)
    
    Returns:
        Current weather conditions including temperature, humidity, and wind
    
    Note:
        - Uses National Weather Service API (no API key required)
        - Only works for US locations
        - Gets data from nearest weather station
    """
    logger.info(f"Getting current weather for coordinates [lat: {latitude:.2f}, lon: {longitude:.2f}]")
    
    # Validate coordinates
    if not (-90 <= latitude <= 90) or not (-180 <= longitude <= 180):
        return "❌ **Error**: Invalid coordinates. Latitude must be -90 to 90, longitude -180 to 180"
    
    # Generate session ID for this weather lookup
    session_id = f"weather_{uuid.uuid4().hex[:8]}"
    
    logger.info(f"Starting weather lookup with session_id: {session_id}")
    
    try:
        # Use agent.callback_handler to send progress as data events  
        if agent and hasattr(agent, 'callback_handler'):
            # Step 1: Connect to weather service - send as data stream
            agent.callback_handler(
                data="🔄 [Progress] Connecting to weather service...\n"
            )
            
        # Send to unified tool events channel
        await tool_events_channel.send_progress(
            "weather", session_id, "connecting", 
            "Connecting to weather service...", 10
        )
        
        if agent and hasattr(agent, 'callback_handler'):
            # Step 2: Fetch weather data - send as data stream
            agent.callback_handler(
                data=f"📡 [Progress] Fetching weather data for coordinates {latitude}, {longitude}...\n"
            )
        
        # Send to unified tool events channel
        await tool_events_channel.send_progress(
            "weather", session_id, "fetching", 
            f"Fetching weather data for coordinates {latitude}, {longitude}...", 40
        )
        
        points_url = f"{NWS_API_BASE}/points/{latitude},{longitude}"
        points_data = await make_nws_request(points_url)
        
        if not points_data:
            await tool_events_channel.error_progress(
                "weather", session_id, 
                "Unable to fetch weather data for this location. Make sure it's within the US."
            )
            return "❌ Unable to fetch weather data for this location. Make sure it's within the US."
        
        stations_url = points_data["properties"]["observationStations"]
        stations_data = await make_nws_request(stations_url)
        
        if not stations_data or not stations_data.get("features"):
            await tool_events_channel.error_progress(
                "weather", session_id, 
                "Unable to find nearby weather stations."
            )
            return "❌ Unable to find nearby weather stations."
        
        station_id = stations_data["features"][0]["properties"]["stationIdentifier"]
        observations_url = f"{NWS_API_BASE}/stations/{station_id}/observations/latest"
        observation_data = await make_nws_request(observations_url)
        
        if not observation_data:
            await tool_events_channel.error_progress(
                "weather", session_id, 
                "Unable to fetch current observations."
            )
            return "❌ Unable to fetch current observations."
        
        if agent and hasattr(agent, 'callback_handler'):
            # Step 3: Process weather information - send as data stream
            agent.callback_handler(
                data="🔄 [Progress] Processing weather information...\n"
            )
        
        # Send to unified tool events channel
        await tool_events_channel.send_progress(
            "weather", session_id, "processing", 
            "Processing weather information...", 80
        )
        
        props = observation_data["properties"]
        
        # Format temperature
        temp_c = props.get("temperature", {}).get("value")
        temp_f = None
        if temp_c is not None:
            temp_f = (temp_c * 9/5) + 32
        
        # Format other data
        humidity = props.get("relativeHumidity", {}).get("value")
        wind_speed = props.get("windSpeed", {}).get("value")
        wind_direction = props.get("windDirection", {}).get("value")
        description = props.get("textDescription", "No description available")
        
        # Choose appropriate weather emoji
        desc_lower = description.lower()
        if "clear" in desc_lower or "sunny" in desc_lower:
            emoji = "☀️"
        elif "cloud" in desc_lower:
            emoji = "☁️"
        elif "rain" in desc_lower:
            emoji = "🌧️"
        elif "snow" in desc_lower:
            emoji = "❄️"
        elif "storm" in desc_lower or "thunder" in desc_lower:
            emoji = "⛈️"
        else:
            emoji = "🌤️"
        
        result = f"""
{emoji} **Current Weather Conditions**
📍 **Location**: {latitude}, {longitude}
📝 **Description**: {description}
"""
        
        if temp_c is not None and temp_f is not None:
            result += f"🌡️ **Temperature**: {temp_c:.1f}°C ({temp_f:.1f}°F)\n"
        
        if humidity is not None:
            result += f"💧 **Humidity**: {humidity:.0f}%\n"
        
        if wind_speed is not None:
            result += f"💨 **Wind Speed**: {wind_speed:.1f} m/s\n"
        
        if wind_direction is not None:
            result += f"🧭 **Wind Direction**: {wind_direction:.0f}°\n"
        
        result += f"\n---\n*Data from NWS Station: {station_id}*"
        
        if agent and hasattr(agent, 'callback_handler'):
            # Step 4: Complete - send as data stream
            agent.callback_handler(
                data="✅ [Progress] Weather data retrieved successfully!\n"
            )
        
        # Send to unified tool events channel
        await tool_events_channel.complete_progress(
            "weather", session_id, 
            "Weather data retrieved successfully!"
        )
        
        # Return structured response with progress summary
        return {
            "status": "success",
            "content": [
                {"text": "🔄 **Progress Summary:**\n"},
                {"text": "✅ Connected to weather service\n"},
                {"text": f"✅ Fetched data for coordinates {latitude}, {longitude}\n"},
                {"text": "✅ Processed weather information\n"},
                {"text": "✅ Retrieved weather data successfully\n\n"},
                {"text": result.strip()}
            ]
        }
        
    except Exception as e:
        error_msg = f"Current weather error: {str(e)}"
        logger.error(error_msg)
        return f"❌ **Current Weather Error**\n\n{error_msg}"
