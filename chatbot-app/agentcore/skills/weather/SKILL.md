---
name: weather
description: Current weather and multi-day forecasts worldwide
---

# Weather

## Available Tools

- **get_today_weather(city_name, country?)**: Get current weather conditions and today's hourly forecast.
  - `city_name` (string, required): City name (e.g., "Seoul", "New York", "London")
  - `country` (string, optional): Country name for disambiguation (e.g., "South Korea")

- **get_weather_forecast(city_name, days?, country?)**: Get multi-day weather forecast (1-16 days).
  - `city_name` (string, required): City name
  - `days` (integer, optional, default: 7): Number of forecast days (1-16)
  - `country` (string, optional): Country name for disambiguation

## Usage Guidelines

- Use city names directly — the API handles geocoding internally.
- Add `country` when the city name is ambiguous (e.g., "Portland" exists in both Oregon and Maine).
- Use `get_today_weather` for current conditions and today's hourly breakdown.
- Use `get_weather_forecast` for multi-day planning (travel, events, outdoor activities).
- Present temperatures in both Celsius and Fahrenheit when the user's preference is unclear.
- Include relevant details: precipitation probability, wind speed, humidity.
