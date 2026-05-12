"""
Tests for Weather Lambda function

Tests cover:
- Geocoding
- Weather code description mapping
- Current weather retrieval
- Forecast retrieval
- Parameter validation
- Error handling
"""
import json
from unittest.mock import patch, MagicMock
from urllib.error import URLError

from conftest import load_lambda

lf = load_lambda("weather")
get_weather_description = lf.get_weather_description
geocode_city = lf.geocode_city
get_today_weather = lf.get_today_weather
get_weather_forecast = lf.get_weather_forecast
lambda_handler = lf.lambda_handler
error_response = lf.error_response

_MODULE = f"{lf.__name__}"


# ============================================================
# Mock Lambda Context
# ============================================================

class MockClientContext:
    def __init__(self, tool_name: str = 'unknown'):
        self.custom = {'bedrockAgentCoreToolName': tool_name}


class MockContext:
    def __init__(self, tool_name: str = 'unknown'):
        self.client_context = MockClientContext(tool_name)


# ============================================================
# Weather Code Description Tests
# ============================================================

class TestWeatherCodeDescription:
    """Tests for WMO weather code to description mapping."""

    def test_clear_sky_code(self):
        assert get_weather_description(0) == "Clear sky"

    def test_cloudy_codes(self):
        assert get_weather_description(1) == "Mainly clear"
        assert get_weather_description(2) == "Partly cloudy"
        assert get_weather_description(3) == "Overcast"

    def test_rain_codes(self):
        assert get_weather_description(61) == "Slight rain"
        assert get_weather_description(63) == "Moderate rain"
        assert get_weather_description(65) == "Heavy rain"

    def test_snow_codes(self):
        assert get_weather_description(71) == "Slight snow"
        assert get_weather_description(73) == "Moderate snow"
        assert get_weather_description(75) == "Heavy snow"

    def test_thunderstorm_codes(self):
        assert get_weather_description(95) == "Thunderstorm"
        assert get_weather_description(96) == "Thunderstorm with slight hail"
        assert get_weather_description(99) == "Thunderstorm with heavy hail"

    def test_unknown_code(self):
        result = get_weather_description(999)
        assert "Unknown weather code" in result
        assert "999" in result


# ============================================================
# Geocoding Tests
# ============================================================

class TestGeocoding:
    """Tests for geocode_city function."""

    def test_successful_geocoding(self):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "results": [{
                "name": "Seoul",
                "latitude": 37.566,
                "longitude": 126.9784,
                "country": "South Korea",
                "timezone": "Asia/Seoul",
                "population": 10349312
            }]
        }).encode('utf-8')
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)

        with patch.object(lf, 'urlopen', return_value=mock_response):
            result = geocode_city("Seoul")

        assert result is not None
        assert result['name'] == "Seoul"
        assert result['latitude'] == 37.566
        assert result['longitude'] == 126.9784
        assert result['country'] == "South Korea"
        assert result['timezone'] == "Asia/Seoul"

    def test_city_not_found(self):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({"results": []}).encode('utf-8')
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)

        with patch.object(lf, 'urlopen', return_value=mock_response):
            result = geocode_city("NonExistentCity12345")

        assert result is None

    def test_geocoding_api_error(self):
        with patch.object(lf, 'urlopen', side_effect=URLError("Connection failed")):
            result = geocode_city("Seoul")

        assert result is None


# ============================================================
# Get Today Weather Tests
# ============================================================

class TestGetTodayWeather:
    """Tests for get_today_weather function."""

    def test_missing_city_name(self):
        result = get_today_weather({})
        assert 'error' in result
        assert 'city_name' in result['error']

    def test_city_not_found_error(self):
        with patch.object(lf, 'geocode_city', return_value=None):
            result = get_today_weather({"city_name": "UnknownCity"})

        assert 'error' in result
        assert 'Could not find location' in result['error']

    def test_successful_weather_retrieval(self):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "current": {
                "temperature_2m": 25.5,
                "apparent_temperature": 27.0,
                "relative_humidity_2m": 65,
                "wind_speed_10m": 10.5,
                "wind_direction_10m": 180,
                "precipitation": 0,
                "weather_code": 1,
                "time": "2024-06-15T14:00"
            },
            "current_units": {
                "temperature_2m": "°C",
                "wind_speed_10m": "km/h"
            },
            "hourly": {
                "time": ["2024-06-15T00:00", "2024-06-15T01:00"],
                "temperature_2m": [22.0, 21.5],
                "precipitation_probability": [10, 15],
                "precipitation": [0, 0],
                "weather_code": [0, 1]
            }
        }).encode('utf-8')
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)

        city = {
            "name": "Seoul", "latitude": 37.566,
            "longitude": 126.9784, "country": "South Korea",
            "timezone": "Asia/Seoul"
        }
        with patch.object(lf, 'geocode_city', return_value=city), \
             patch.object(lf, 'urlopen', return_value=mock_response):
            result = get_today_weather({"city_name": "Seoul"})

        assert 'location' in result
        assert result['location']['name'] == "Seoul"
        assert 'current_weather' in result
        assert result['current_weather']['temperature'] == 25.5
        assert 'hourly_forecast' in result


# ============================================================
# Get Weather Forecast Tests
# ============================================================

class TestGetWeatherForecast:
    """Tests for get_weather_forecast function."""

    def test_missing_city_name(self):
        result = get_weather_forecast({})
        assert 'error' in result
        assert 'city_name' in result['error']

    def test_invalid_days_parameter(self):
        result = get_weather_forecast({"city_name": "Seoul", "days": 0})
        assert 'error' in result

        result = get_weather_forecast({"city_name": "Seoul", "days": 20})
        assert 'error' in result

    def test_days_default_value(self):
        with patch.object(lf, 'geocode_city', return_value=None):
            result = get_weather_forecast({"city_name": "Seoul"})

        assert 'Could not find location' in result.get('error', '')

    def test_successful_forecast_retrieval(self):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "daily": {
                "time": ["2024-06-15", "2024-06-16", "2024-06-17"],
                "temperature_2m_max": [28, 29, 27],
                "temperature_2m_min": [20, 21, 19],
                "precipitation_sum": [0, 5, 2],
                "precipitation_probability_max": [10, 60, 40],
                "weather_code": [1, 63, 61],
                "sunrise": ["05:30", "05:31", "05:32"],
                "sunset": ["19:00", "19:01", "19:02"],
                "wind_speed_10m_max": [15, 20, 18]
            },
            "daily_units": {
                "temperature_2m_max": "°C",
                "wind_speed_10m_max": "km/h"
            }
        }).encode('utf-8')
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=None)

        city = {
            "name": "Tokyo", "latitude": 35.6762,
            "longitude": 139.6503, "country": "Japan",
            "timezone": "Asia/Tokyo"
        }
        with patch.object(lf, 'geocode_city', return_value=city), \
             patch.object(lf, 'urlopen', return_value=mock_response):
            result = get_weather_forecast({"city_name": "Tokyo", "days": 3})

        assert 'location' in result
        assert result['location']['name'] == "Tokyo"
        assert 'daily_forecast' in result
        assert len(result['daily_forecast']) == 3
        assert result['daily_forecast'][0]['temperature_max'] == 28
        assert result['daily_forecast'][1]['weather_description'] == "Moderate rain"


# ============================================================
# Lambda Handler Tests
# ============================================================

class TestLambdaHandler:
    """Tests for lambda_handler routing."""

    def test_routes_to_get_today_weather(self):
        context = MockContext('get_today_weather')
        with patch.object(lf, 'geocode_city', return_value=None):
            result = lambda_handler({"city_name": "Seoul"}, context)
        assert 'error' in result

    def test_routes_to_get_weather_forecast(self):
        context = MockContext('get_weather_forecast')
        with patch.object(lf, 'geocode_city', return_value=None):
            result = lambda_handler({"city_name": "Tokyo"}, context)
        assert 'error' in result

    def test_unknown_tool_returns_error(self):
        context = MockContext('unknown_weather_tool')
        result = lambda_handler({}, context)
        assert 'error' in result
        assert 'Unknown tool' in result['error']

    def test_handles_tool_name_with_prefix(self):
        context = MockContext('weather___get_today_weather')
        with patch.object(lf, 'geocode_city', return_value=None):
            result = lambda_handler({"city_name": "Seoul"}, context)
        assert 'Could not find location' in result.get('error', '')


# ============================================================
# Error Response Tests
# ============================================================

class TestErrorResponse:
    """Tests for error response formatting."""

    def test_error_response_format(self):
        result = error_response("Test error message")
        assert result == {"error": "Test error message"}
