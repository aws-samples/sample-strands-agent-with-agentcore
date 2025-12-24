"""
Google Maps Visualization Tool
Formats location data for interactive map rendering in frontend
"""

import json
import logging
from typing import Any, Literal, Optional
from strands import tool

logger = logging.getLogger(__name__)


def validate_marker(marker: dict[str, Any]) -> tuple[bool, str | None]:
    """Validate marker structure"""
    if "lat" not in marker or "lng" not in marker:
        return False, "Marker must have 'lat' and 'lng' fields"

    # Validate coordinate ranges
    lat = marker.get("lat")
    lng = marker.get("lng")

    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return False, "Latitude and longitude must be numbers"

    if not (-90 <= lat <= 90):
        return False, f"Latitude {lat} out of range (-90 to 90)"

    if not (-180 <= lng <= 180):
        return False, f"Longitude {lng} out of range (-180 to 180)"

    return True, None


def validate_directions(directions: dict[str, Any]) -> tuple[bool, str | None]:
    """Validate directions structure"""
    if "origin" not in directions or "destination" not in directions:
        return False, "Directions must have 'origin' and 'destination' fields"

    # Validate origin
    origin = directions.get("origin")
    if not isinstance(origin, dict) or "lat" not in origin or "lng" not in origin:
        return False, "Origin must be a dict with 'lat' and 'lng'"

    # Validate destination
    destination = directions.get("destination")
    if not isinstance(destination, dict) or "lat" not in destination or "lng" not in destination:
        return False, "Destination must be a dict with 'lat' and 'lng'"

    return True, None


def calculate_center_from_markers(markers: list[dict[str, Any]]) -> dict[str, float]:
    """Calculate center point from list of markers"""
    if not markers:
        return {"lat": 0, "lng": 0}

    lat_sum = sum(m["lat"] for m in markers)
    lng_sum = sum(m["lng"] for m in markers)

    return {
        "lat": lat_sum / len(markers),
        "lng": lng_sum / len(markers)
    }


def calculate_zoom_level(markers: list[dict[str, Any]] | None, directions: dict[str, Any] | None) -> int:
    """
    Calculate appropriate zoom level based on data spread

    Zoom levels (approximate):
    - 1: World
    - 5: Continent
    - 10: City
    - 15: Streets
    - 20: Buildings
    """
    if not markers and not directions:
        return 12  # Default

    coords = []

    # Collect all coordinates
    if markers:
        coords.extend([(m["lat"], m["lng"]) for m in markers])

    if directions:
        origin = directions.get("origin", {})
        dest = directions.get("destination", {})
        if "lat" in origin and "lng" in origin:
            coords.append((origin["lat"], origin["lng"]))
        if "lat" in dest and "lng" in dest:
            coords.append((dest["lat"], dest["lng"]))

    if len(coords) <= 1:
        return 15  # Single point - street level

    # Calculate lat/lng ranges
    lats = [c[0] for c in coords]
    lngs = [c[1] for c in coords]

    lat_range = max(lats) - min(lats)
    lng_range = max(lngs) - min(lngs)
    max_range = max(lat_range, lng_range)

    # Estimate zoom level based on coordinate range
    if max_range > 10:
        return 5   # Continental
    elif max_range > 1:
        return 9   # Regional
    elif max_range > 0.1:
        return 12  # City
    elif max_range > 0.01:
        return 14  # Neighborhood
    else:
        return 15  # Street


@tool
def show_on_map(
    map_type: Literal["markers", "directions", "area"],
    markers: Optional[list[dict[str, Any]]] = None,
    directions: Optional[dict[str, Any]] = None,
    center: Optional[dict[str, float]] = None,
    zoom: Optional[int] = None
) -> str:
    """
    Display locations, routes, or areas on an interactive Google Map embedded in chat.

    Use after collecting location data to present results visually. Helpful when user requests
    map view, when comparing locations, or when showing routes/directions.

    Args:
        map_type: "markers" (location pins), "directions" (route with path), or "area" (region)

        markers: List of markers for map_type="markers". Each marker needs lat/lng.
            Optional fields: label, title, description, place_id

        directions: Route data for map_type="directions". Required: origin and destination with lat/lng.
            Optional: polyline, mode, distance, duration

        center: Map center {lat, lng}. Auto-calculated if omitted.

        zoom: Zoom level 1-20 (1=World, 20=Buildings). Auto-calculated if omitted.

    Returns:
        JSON with map_data for frontend rendering

    Example:
        show_on_map(map_type="markers", markers=[{"lat": 40.7580, "lng": -73.9855, "title": "Place"}])
    """
    try:
        # Validate map_type
        if map_type not in ["markers", "directions", "area"]:
            error_dict = {
                "success": False,
                "error": f"Invalid map_type: {map_type}. Must be 'markers', 'directions', or 'area'"
            }
            return json.dumps(error_dict)

        # Validate required data based on type
        if map_type == "markers":
            if not markers or len(markers) == 0:
                error_dict = {
                    "success": False,
                    "error": "markers parameter required and must not be empty for map_type='markers'"
                }
                return json.dumps(error_dict)

            # Validate each marker
            for idx, marker in enumerate(markers):
                is_valid, error_msg = validate_marker(marker)
                if not is_valid:
                    error_dict = {
                        "success": False,
                        "error": f"Marker {idx}: {error_msg}"
                    }
                    return json.dumps(error_dict)

        elif map_type == "directions":
            if not directions:
                error_dict = {
                    "success": False,
                    "error": "directions parameter required for map_type='directions'"
                }
                return json.dumps(error_dict)

            is_valid, error_msg = validate_directions(directions)
            if not is_valid:
                error_dict = {
                    "success": False,
                    "error": f"Directions: {error_msg}"
                }
                return json.dumps(error_dict)

        # Auto-calculate center if not provided
        if not center:
            if map_type == "markers" and markers:
                center = calculate_center_from_markers(markers)
            elif map_type == "directions" and directions:
                # Center between origin and destination
                origin = directions.get("origin", {})
                dest = directions.get("destination", {})
                center = {
                    "lat": (origin.get("lat", 0) + dest.get("lat", 0)) / 2,
                    "lng": (origin.get("lng", 0) + dest.get("lng", 0)) / 2
                }
            else:
                center = {"lat": 0, "lng": 0}

        # Auto-calculate zoom if not provided
        if not zoom:
            zoom = calculate_zoom_level(markers, directions)

        # Ensure zoom is in valid range
        zoom = max(1, min(20, zoom))

        # Build map data structure
        map_data = {
            "type": map_type,
            "center": center,
            "zoom": zoom
        }

        if markers:
            map_data["markers"] = markers

        if directions:
            map_data["directions"] = directions

        # Create success message
        if map_type == "markers":
            count = len(markers) if markers else 0
            message = f"📍 Showing {count} location(s) on map"
        elif map_type == "directions":
            origin_addr = directions.get("origin", {}).get("address", "Start")
            dest_addr = directions.get("destination", {}).get("address", "End")
            message = f"🗺️ Showing route from {origin_addr} to {dest_addr}"
        else:
            message = f"🗺️ Showing map ({map_type})"

        logger.info(f"Created map visualization: type={map_type}, markers={len(markers or [])}, zoom={zoom}")

        # Return as JSON string
        result_dict = {
            "success": True,
            "map_data": map_data,
            "message": message
        }

        return json.dumps(result_dict)

    except Exception as e:
        logger.error(f"Error creating map visualization: {e}")
        error_dict = {
            "success": False,
            "error": str(e),
            "map_type": map_type
        }
        return json.dumps(error_dict)
