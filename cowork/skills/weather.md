---
name: weather
description: Current weather and multi-day forecasts worldwide
available_tools:
  - weather___get_today_weather
  - weather___get_weather_forecast
---
# Weather

## Available Tools

- **weather___get_today_weather(city_name, country)**: Get current weather and today's hourly forecast.
  - `city_name` (string, required): City name (e.g., "Seoul", "New York")
  - `country` (string, optional): Country name for disambiguation

- **weather___get_weather_forecast(city_name, days, country)**: Get multi-day forecast (1-16 days).
  - `city_name` (string, required): City name
  - `days` (int, default: 7): Number of forecast days (1-16)
  - `country` (string, optional): Country name for disambiguation

## Usage Guidelines
- Use city names directly; the API handles geocoding internally.
- Add country when the city name is ambiguous (e.g., "Portland" in Oregon vs Maine).
- Use get_today_weather for current conditions, get_weather_forecast for multi-day planning.
