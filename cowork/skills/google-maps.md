---
name: google-maps
description: Place search, directions, geocoding, and interactive maps
available_tools:
  - google-maps___search_places
  - google-maps___search_nearby_places
  - google-maps___get_place_details
  - google-maps___get_directions
  - google-maps___geocode_address
  - google-maps___reverse_geocode
  - google-maps___show_on_map
---
# Google Maps

## Available Tools

- **google-maps___search_places(query, location, radius, type, open_now, language)**: Search for places using text query.
  - `query` (string, required): Search text (e.g., "restaurants in Seoul")
  - `location` (string, optional): Center as "lat,lng"
  - `radius` (int, optional): Search radius in meters (max 50,000)

- **google-maps___search_nearby_places(location, radius, keyword, type)**: Search near specific coordinates.
  - `location` (string, required): Center as "lat,lng"
  - `radius` (int, required): Search radius in meters

- **google-maps___get_place_details(place_id, language)**: Get detailed place info including reviews and hours.
  - `place_id` (string, required): Place ID from search results

- **google-maps___get_directions(origin, destination, mode, alternatives)**: Get directions between locations.
  - `origin` (string, required): Starting point
  - `destination` (string, required): Destination
  - `mode` (string, default: "driving"): "driving", "walking", "bicycling", "transit"

- **google-maps___geocode_address(address)**: Convert address to coordinates.
  - `address` (string, required): Address to geocode

- **google-maps___reverse_geocode(latlng)**: Convert coordinates to address.
  - `latlng` (string, required): Coordinates as "lat,lng"

- **google-maps___show_on_map(map_type, markers, directions, center, zoom)**: Display on interactive map.
  - `map_type` (string, required): "markers", "directions", or "area"

## Usage Guidelines
- Always call show_on_map after collecting location data.
- Follow Text -> Map -> Text sequence. Do NOT call show_on_map in parallel with other tools.
- Preserve place_id from search results for use with get_place_details.
- Show 1-5 most relevant places per map.
