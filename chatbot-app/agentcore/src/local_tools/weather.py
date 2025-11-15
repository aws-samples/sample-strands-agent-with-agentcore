"""
Simple Weather Tool - Strands Native
Uses National Weather Service API without external dependencies
"""

import httpx
import logging
from strands import tool

logger = logging.getLogger(__name__)

NWS_API_BASE = "https://api.weather.gov"
USER_AGENT = "strands-weather-tool/1.0"


async def make_nws_request(url: str) -> dict | None:
    """Make a request to the NWS API"""
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
async def get_current_weather(latitude: float, longitude: float) -> dict:
    """
    Get current weather conditions for a US location using coordinates.

    Args:
        latitude: Latitude of the location (e.g., 40.7128 for NYC)
        longitude: Longitude of the location (e.g., -74.0060 for NYC)

    Returns:
        Current weather conditions including temperature, humidity, and wind

    Example:
        # New York City
        get_current_weather(40.7128, -74.0060)

        # San Francisco
        get_current_weather(37.7749, -122.4194)
    """
    try:
        # Step 1: Get grid point from coordinates
        point_url = f"{NWS_API_BASE}/points/{latitude},{longitude}"
        point_data = await make_nws_request(point_url)

        if not point_data:
            return {
                "error": "Unable to fetch weather data for this location",
                "latitude": latitude,
                "longitude": longitude
            }

        # Step 2: Get forecast office and grid coordinates
        properties = point_data.get("properties", {})
        forecast_url = properties.get("forecast")

        if not forecast_url:
            return {
                "error": "Location is outside NWS coverage area",
                "latitude": latitude,
                "longitude": longitude
            }

        # Step 3: Get current forecast
        forecast_data = await make_nws_request(forecast_url)

        if not forecast_data:
            return {
                "error": "Unable to fetch forecast data",
                "latitude": latitude,
                "longitude": longitude
            }

        # Parse forecast
        periods = forecast_data.get("properties", {}).get("periods", [])
        if not periods:
            return {
                "error": "No forecast data available",
                "latitude": latitude,
                "longitude": longitude
            }

        # Get current period (first period)
        current = periods[0]

        return {
            "location": {
                "latitude": latitude,
                "longitude": longitude,
                "name": properties.get("relativeLocation", {}).get("properties", {}).get("city", "Unknown")
            },
            "current_conditions": {
                "temperature": current.get("temperature"),
                "temperature_unit": current.get("temperatureUnit"),
                "wind_speed": current.get("windSpeed"),
                "wind_direction": current.get("windDirection"),
                "short_forecast": current.get("shortForecast"),
                "detailed_forecast": current.get("detailedForecast")
            },
            "period": current.get("name"),
            "updated": current.get("startTime")
        }

    except Exception as e:
        logger.error(f"Error getting weather: {e}")
        return {
            "error": str(e),
            "latitude": latitude,
            "longitude": longitude
        }
