# Weather Lambda for AgentCore Gateway

This Lambda function provides weather information using the [Open-Meteo API](https://open-meteo.com/), which requires no API key and is free to use.

## Tools Provided

### 1. `get_today_weather`

Get current weather conditions and today's hourly forecast.

**Parameters:**
- `city_name` (string, required): City name (e.g., "Seoul", "New York", "London")
- `country` (string, optional): Country name for disambiguation

**Returns:**
- Current weather conditions (temperature, humidity, wind, precipitation)
- Hourly forecast for today (24 hours)

**Example:**
```json
{
  "city_name": "Seoul",
  "country": "South Korea"
}
```

### 2. `get_weather_forecast`

Get multi-day weather forecast (up to 16 days).

**Parameters:**
- `city_name` (string, required): City name
- `days` (integer, optional): Number of forecast days (1-16, default 7)
- `country` (string, optional): Country name for disambiguation

**Returns:**
- Daily forecast with max/min temperatures, precipitation, sunrise/sunset

**Example:**
```json
{
  "city_name": "Tokyo",
  "days": 10
}
```

## How It Works

1. **Geocoding**: Converts city name to coordinates using Open-Meteo Geocoding API
2. **Weather Data**: Fetches weather information using Open-Meteo Weather API
3. **No API Key Required**: Open-Meteo is free and doesn't require authentication

## Data Source

- **API**: [Open-Meteo](https://open-meteo.com/)
- **Weather Codes**: [WMO Weather Interpretation Codes](https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM)
- **Coverage**: Worldwide
- **Forecast Range**: Up to 16 days

## Testing Locally

```python
# Test get_today_weather
event = {
    "city_name": "Seoul"
}

# Test get_weather_forecast
event = {
    "city_name": "New York",
    "days": 7
}
```

## Dependencies

None - uses built-in Python `urllib` for HTTP requests.
