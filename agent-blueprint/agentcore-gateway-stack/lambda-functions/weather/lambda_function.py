"""
Weather Lambda for AgentCore Gateway
Provides current weather and forecast using Open-Meteo API
"""
import json
import logging
from typing import Dict, Any, Optional, List
from urllib.parse import urlencode
from urllib.request import urlopen

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Open-Meteo API endpoints (no API key required)
GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search"
WEATHER_API = "https://api.open-meteo.com/v1/forecast"

# WMO Weather Code Descriptions
WEATHER_CODE_DESC = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail"
}


def lambda_handler(event, context):
    """
    Lambda handler for Weather tools via AgentCore Gateway

    Gateway unwraps tool arguments and passes them directly to Lambda
    """
    try:
        logger.info(f"Event: {json.dumps(event)}")

        # Get tool name from context (set by AgentCore Gateway)
        tool_name = 'unknown'
        if hasattr(context, 'client_context') and context.client_context:
            if hasattr(context.client_context, 'custom'):
                tool_name = context.client_context.custom.get('bedrockAgentCoreToolName', '')
                if '___' in tool_name:
                    tool_name = tool_name.split('___')[-1]

        logger.info(f"Tool name: {tool_name}")

        # Route to appropriate tool
        if tool_name == 'get_today_weather':
            return get_today_weather(event)
        elif tool_name == 'get_weather_forecast':
            return get_weather_forecast(event)
        else:
            return error_response(f"Unknown tool: {tool_name}")

    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)
        return error_response(str(e))


def geocode_city(city_name: str, country: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Convert city name to coordinates using Open-Meteo Geocoding API

    Returns:
        {
            "name": "Seoul",
            "latitude": 37.566,
            "longitude": 126.9784,
            "country": "South Korea",
            "timezone": "Asia/Seoul"
        }
    """
    try:
        params = {
            "name": city_name,
            "count": 1,
            "language": "en",
            "format": "json"
        }

        url = f"{GEOCODING_API}?{urlencode(params)}"
        logger.info(f"Geocoding request: {url}")

        with urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        if not data.get("results"):
            return None

        result = data["results"][0]

        return {
            "name": result.get("name"),
            "latitude": result.get("latitude"),
            "longitude": result.get("longitude"),
            "country": result.get("country"),
            "timezone": result.get("timezone"),
            "population": result.get("population")
        }

    except Exception as e:
        logger.error(f"Geocoding error: {str(e)}")
        return None


def get_weather_description(code: int) -> str:
    """Convert WMO weather code to description"""
    return WEATHER_CODE_DESC.get(code, f"Unknown weather code: {code}")


def get_today_weather(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get today's weather with current conditions and hourly forecast

    Args:
        city_name: City name (e.g., "Seoul", "New York")
        country: Optional country name for disambiguation

    Returns:
        Current weather and today's hourly forecast (24 hours)
    """
    try:
        city_name = event.get("city_name")
        country = event.get("country")

        if not city_name:
            return error_response("city_name is required")

        # Step 1: Geocode city name
        location = geocode_city(city_name, country)
        if not location:
            return error_response(f"Could not find location: {city_name}")

        # Step 2: Get weather data
        params = {
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "current": ",".join([
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "precipitation",
                "weather_code",
                "wind_speed_10m",
                "wind_direction_10m"
            ]),
            "hourly": ",".join([
                "temperature_2m",
                "precipitation_probability",
                "precipitation",
                "weather_code"
            ]),
            "timezone": "auto",
            "forecast_days": 1
        }

        url = f"{WEATHER_API}?{urlencode(params)}"
        logger.info("Weather request for current conditions")

        with urlopen(url, timeout=10) as response:
            weather_data = json.loads(response.read().decode('utf-8'))

        # Parse current weather
        current = weather_data.get("current", {})
        current_weather = {
            "temperature": current.get("temperature_2m"),
            "temperature_unit": weather_data.get("current_units", {}).get("temperature_2m", "°C"),
            "feels_like": current.get("apparent_temperature"),
            "humidity": current.get("relative_humidity_2m"),
            "wind_speed": current.get("wind_speed_10m"),
            "wind_speed_unit": weather_data.get("current_units", {}).get("wind_speed_10m", "km/h"),
            "wind_direction": current.get("wind_direction_10m"),
            "precipitation": current.get("precipitation"),
            "weather_code": current.get("weather_code"),
            "weather_description": get_weather_description(current.get("weather_code", 0)),
            "time": current.get("time")
        }

        # Parse hourly forecast (today only)
        hourly = weather_data.get("hourly", {})
        hourly_forecast = []

        times = hourly.get("time", [])
        temps = hourly.get("temperature_2m", [])
        precip_prob = hourly.get("precipitation_probability", [])
        precip = hourly.get("precipitation", [])
        codes = hourly.get("weather_code", [])

        for i in range(min(len(times), 24)):  # Today only (24 hours)
            hourly_forecast.append({
                "time": times[i],
                "temperature": temps[i],
                "precipitation_probability": precip_prob[i] if precip_prob else None,
                "precipitation": precip[i],
                "weather_code": codes[i],
                "weather_description": get_weather_description(codes[i])
            })

        return {
            "location": {
                "name": location["name"],
                "country": location["country"],
                "latitude": location["latitude"],
                "longitude": location["longitude"],
                "timezone": location["timezone"]
            },
            "current_weather": current_weather,
            "hourly_forecast": hourly_forecast
        }

    except Exception as e:
        logger.error(f"Error in get_today_weather: {str(e)}", exc_info=True)
        return error_response(str(e))


def get_weather_forecast(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get multi-day weather forecast

    Args:
        city_name: City name (e.g., "Seoul", "New York")
        days: Number of forecast days (1-16, default 7)
        country: Optional country name for disambiguation

    Returns:
        Daily weather forecast for specified number of days
    """
    try:
        city_name = event.get("city_name")
        days = event.get("days", 7)
        country = event.get("country")

        if not city_name:
            return error_response("city_name is required")

        # Validate days parameter
        if not isinstance(days, int) or days < 1 or days > 16:
            return error_response("days must be between 1 and 16")

        # Step 1: Geocode city name
        location = geocode_city(city_name, country)
        if not location:
            return error_response(f"Could not find location: {city_name}")

        # Step 2: Get weather forecast
        params = {
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "daily": ",".join([
                "temperature_2m_max",
                "temperature_2m_min",
                "precipitation_sum",
                "precipitation_probability_max",
                "weather_code",
                "sunrise",
                "sunset",
                "wind_speed_10m_max"
            ]),
            "timezone": "auto",
            "forecast_days": days
        }

        url = f"{WEATHER_API}?{urlencode(params)}"
        logger.info(f"Forecast request for {days} days")

        with urlopen(url, timeout=10) as response:
            forecast_data = json.loads(response.read().decode('utf-8'))

        # Parse daily forecast
        daily = forecast_data.get("daily", {})
        daily_forecast = []

        dates = daily.get("time", [])
        max_temps = daily.get("temperature_2m_max", [])
        min_temps = daily.get("temperature_2m_min", [])
        precip_sum = daily.get("precipitation_sum", [])
        precip_prob = daily.get("precipitation_probability_max", [])
        codes = daily.get("weather_code", [])
        sunrises = daily.get("sunrise", [])
        sunsets = daily.get("sunset", [])
        wind_speeds = daily.get("wind_speed_10m_max", [])

        for i in range(len(dates)):
            daily_forecast.append({
                "date": dates[i],
                "temperature_max": max_temps[i],
                "temperature_min": min_temps[i],
                "temperature_unit": forecast_data.get("daily_units", {}).get("temperature_2m_max", "°C"),
                "precipitation_sum": precip_sum[i],
                "precipitation_probability": precip_prob[i],
                "weather_code": codes[i],
                "weather_description": get_weather_description(codes[i]),
                "sunrise": sunrises[i],
                "sunset": sunsets[i],
                "wind_speed_max": wind_speeds[i],
                "wind_speed_unit": forecast_data.get("daily_units", {}).get("wind_speed_10m_max", "km/h")
            })

        return {
            "location": {
                "name": location["name"],
                "country": location["country"],
                "latitude": location["latitude"],
                "longitude": location["longitude"],
                "timezone": location["timezone"]
            },
            "forecast_days": days,
            "daily_forecast": daily_forecast
        }

    except Exception as e:
        logger.error(f"Error in get_weather_forecast: {str(e)}", exc_info=True)
        return error_response(str(e))


def error_response(message: str) -> Dict[str, Any]:
    """Return error response"""
    return {
        "error": message
    }
