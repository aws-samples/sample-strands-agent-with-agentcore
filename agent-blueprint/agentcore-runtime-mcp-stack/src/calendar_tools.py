"""
Google Calendar Tools for MCP Server

Provides Google Calendar tools with per-user OAuth authentication.
These tools are registered to a shared FastMCP instance.

Tools:
- list_calendars: List user's calendars
- list_events: List events from a calendar
- get_event: Get event details
- create_event: Create a new event
- update_event: Update an existing event
- delete_event: Delete an event
- quick_add_event: Create event from natural language text
- check_availability: Check free/busy status
"""
import json
import httpx
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from mcp.server.fastmcp import Context
from agentcore_oauth import OAuthHelper, get_token_with_elicitation

logger = logging.getLogger(__name__)

# Google Calendar API configuration
CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"

# OAuth helper for Calendar (same provider as Gmail, different scopes)
_calendar_oauth = OAuthHelper(
    provider_name="google-oauth-provider",
    scopes=[
        "https://www.googleapis.com/auth/calendar",  # Full calendar access
    ],
)


# ── Calendar API Callers ─────────────────────────────────────────────────

# Shared HTTP client for connection pooling
_http_client: Optional[httpx.AsyncClient] = None


async def _get_http_client() -> httpx.AsyncClient:
    """Get or create shared HTTP client for connection reuse."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


async def call_calendar_api_get(
    access_token: str, endpoint: str, params: Optional[Dict] = None
) -> Dict:
    """Calendar REST API GET caller."""
    url = f"{CALENDAR_API_BASE}/{endpoint}"
    headers = {"Authorization": f"Bearer {access_token}"}

    client = await _get_http_client()
    response = await client.get(url, headers=headers, params=params)
    response.raise_for_status()
    return response.json()


async def call_calendar_api_post(
    access_token: str, endpoint: str, data: Optional[Dict] = None, params: Optional[Dict] = None
) -> Dict:
    """Calendar REST API POST caller."""
    url = f"{CALENDAR_API_BASE}/{endpoint}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    client = await _get_http_client()
    response = await client.post(url, headers=headers, json=data, params=params)
    response.raise_for_status()

    if not response.content:
        return {}
    return response.json()


async def call_calendar_api_put(
    access_token: str, endpoint: str, data: Optional[Dict] = None
) -> Dict:
    """Calendar REST API PUT caller."""
    url = f"{CALENDAR_API_BASE}/{endpoint}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    client = await _get_http_client()
    response = await client.put(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()


async def call_calendar_api_delete(access_token: str, endpoint: str) -> bool:
    """Calendar REST API DELETE caller."""
    url = f"{CALENDAR_API_BASE}/{endpoint}"
    headers = {"Authorization": f"Bearer {access_token}"}

    client = await _get_http_client()
    response = await client.delete(url, headers=headers)
    response.raise_for_status()
    return True


# ── Helper Functions ─────────────────────────────────────────────────


def _format_event_response(event: Dict) -> Dict:
    """Format event data for response."""
    start = event.get("start", {})
    end = event.get("end", {})

    return {
        "id": event.get("id", ""),
        "summary": event.get("summary", "(no title)"),
        "description": event.get("description", ""),
        "location": event.get("location", ""),
        "start": start.get("dateTime") or start.get("date", ""),
        "end": end.get("dateTime") or end.get("date", ""),
        "timeZone": start.get("timeZone", ""),
        "status": event.get("status", ""),
        "htmlLink": event.get("htmlLink", ""),
        "created": event.get("created", ""),
        "updated": event.get("updated", ""),
        "creator": event.get("creator", {}),
        "organizer": event.get("organizer", {}),
        "attendees": event.get("attendees", []),
        "reminders": event.get("reminders", {}),
        "recurrence": event.get("recurrence", []),
    }


def _build_event_body(
    summary: str,
    start_time: str,
    end_time: str,
    description: Optional[str] = None,
    location: Optional[str] = None,
    attendees: Optional[List[str]] = None,
    timezone: str = "UTC",
    all_day: bool = False,
    reminders_minutes: Optional[List[int]] = None,
) -> Dict:
    """Build event request body."""
    event = {
        "summary": summary,
    }

    if description:
        event["description"] = description
    if location:
        event["location"] = location

    # Handle all-day vs timed events
    if all_day:
        event["start"] = {"date": start_time}
        event["end"] = {"date": end_time}
    else:
        event["start"] = {"dateTime": start_time, "timeZone": timezone}
        event["end"] = {"dateTime": end_time, "timeZone": timezone}

    # Add attendees
    if attendees:
        event["attendees"] = [{"email": email.strip()} for email in attendees]

    # Add reminders
    if reminders_minutes:
        event["reminders"] = {
            "useDefault": False,
            "overrides": [
                {"method": "popup", "minutes": m} for m in reminders_minutes
            ]
        }

    return event


# ── Tool Registration ───────────────────────────────────────────────────


def register_calendar_tools(mcp):
    """Register Google Calendar tools to a FastMCP instance.

    Args:
        mcp: FastMCP instance to register tools to
    """

    @mcp.tool()
    async def list_calendars(ctx: Context) -> str:
        """List all calendars accessible to the user.

        Returns calendars from the user's calendar list including
        primary calendar, subscribed calendars, and shared calendars.
        """
        logger.debug("[Tool] list_calendars called")

        try:
            access_token = await get_token_with_elicitation(ctx, _calendar_oauth, "Google Calendar")
            if access_token is None:
                return "Authorization was declined by the user."

            data = await call_calendar_api_get(access_token, "users/me/calendarList")
            calendars = data.get("items", [])

            results = []
            for cal in calendars:
                results.append({
                    "id": cal.get("id", ""),
                    "summary": cal.get("summary", ""),
                    "description": cal.get("description", ""),
                    "primary": cal.get("primary", False),
                    "accessRole": cal.get("accessRole", ""),
                    "backgroundColor": cal.get("backgroundColor", ""),
                    "timeZone": cal.get("timeZone", ""),
                })

            return json.dumps({
                "calendars": results,
                "total_count": len(results),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error listing calendars: {e}")
            return f"Error listing calendars: {str(e)}"

    @mcp.tool()
    async def list_events(
        calendar_id: str = "primary",
        max_results: int = 10,
        time_min: Optional[str] = None,
        time_max: Optional[str] = None,
        query: Optional[str] = None,
        show_deleted: bool = False,
        ctx: Context = None,
    ) -> str:
        """List events from a calendar.

        Args:
            calendar_id: Calendar ID (use "primary" for user's primary calendar). Default: primary.
            max_results: Maximum number of events (1-100, default 10).
            time_min: Start time filter in RFC3339 format (e.g., 2024-01-01T00:00:00Z). Defaults to now.
            time_max: End time filter in RFC3339 format (e.g., 2024-12-31T23:59:59Z).
            query: Free text search terms to find events.
            show_deleted: Include deleted events. Default: False.
        """
        max_results = max(1, min(100, max_results))

        try:
            access_token = await get_token_with_elicitation(ctx, _calendar_oauth, "Google Calendar")
            if access_token is None:
                return "Authorization was declined by the user."

            params = {
                "maxResults": max_results,
                "singleEvents": True,  # Expand recurring events
                "orderBy": "startTime",
                "showDeleted": show_deleted,
            }

            # Default time_min to now if not specified
            if time_min:
                params["timeMin"] = time_min
            else:
                params["timeMin"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

            if time_max:
                params["timeMax"] = time_max
            if query:
                params["q"] = query

            data = await call_calendar_api_get(
                access_token,
                f"calendars/{calendar_id}/events",
                params=params
            )

            events = data.get("items", [])
            results = [_format_event_response(event) for event in events]

            return json.dumps({
                "calendar_id": calendar_id,
                "events": results,
                "total_count": len(results),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error listing events: {e}")
            return f"Error listing events: {str(e)}"

    @mcp.tool()
    async def get_event(
        event_id: str,
        calendar_id: str = "primary",
        ctx: Context = None,
    ) -> str:
        """Get detailed information about a specific event.

        Args:
            event_id: The event ID (obtained from list_events).
            calendar_id: Calendar ID containing the event. Default: primary.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _calendar_oauth, "Google Calendar")
            if access_token is None:
                return "Authorization was declined by the user."

            event = await call_calendar_api_get(
                access_token,
                f"calendars/{calendar_id}/events/{event_id}"
            )

            result = _format_event_response(event)
            return json.dumps(result, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error getting event: {e}")
            return f"Error getting event: {str(e)}"

    @mcp.tool()
    async def create_event(
        summary: str,
        start_time: str,
        end_time: str,
        calendar_id: str = "primary",
        description: Optional[str] = None,
        location: Optional[str] = None,
        attendees: Optional[str] = None,
        timezone: str = "UTC",
        all_day: bool = False,
        reminder_minutes: Optional[str] = None,
        ctx: Context = None,
    ) -> str:
        """Create a new calendar event.

        Args:
            summary: Event title/summary.
            start_time: Start time in RFC3339 format (e.g., 2024-01-15T09:00:00) or date for all-day (2024-01-15).
            end_time: End time in RFC3339 format or date for all-day events.
            calendar_id: Calendar ID to create event in. Default: primary.
            description: Event description/notes. Optional.
            location: Event location. Optional.
            attendees: Comma-separated email addresses of attendees. Optional.
            timezone: Timezone for the event (e.g., Asia/Seoul, America/New_York). Default: UTC.
            all_day: If True, creates an all-day event (use date format YYYY-MM-DD). Default: False.
            reminder_minutes: Comma-separated reminder times in minutes (e.g., "10,30,60"). Optional.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _calendar_oauth, "Google Calendar")
            if access_token is None:
                return "Authorization was declined by the user."

            # Parse attendees
            attendee_list = None
            if attendees:
                attendee_list = [e.strip() for e in attendees.split(",") if e.strip()]

            # Parse reminders
            reminder_list = None
            if reminder_minutes:
                reminder_list = [int(m.strip()) for m in reminder_minutes.split(",") if m.strip()]

            event_body = _build_event_body(
                summary=summary,
                start_time=start_time,
                end_time=end_time,
                description=description,
                location=location,
                attendees=attendee_list,
                timezone=timezone,
                all_day=all_day,
                reminders_minutes=reminder_list,
            )

            result = await call_calendar_api_post(
                access_token,
                f"calendars/{calendar_id}/events",
                data=event_body
            )

            return json.dumps({
                "success": True,
                "message": "Event created successfully",
                "event": _format_event_response(result),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error creating event: {e}")
            return f"Error creating event: {str(e)}"

    @mcp.tool()
    async def update_event(
        event_id: str,
        calendar_id: str = "primary",
        summary: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        description: Optional[str] = None,
        location: Optional[str] = None,
        attendees: Optional[str] = None,
        timezone: Optional[str] = None,
        ctx: Context = None,
    ) -> str:
        """Update an existing calendar event.

        Only specified fields will be updated. Other fields remain unchanged.

        Args:
            event_id: The event ID to update.
            calendar_id: Calendar ID containing the event. Default: primary.
            summary: New event title. Optional.
            start_time: New start time in RFC3339 format. Optional.
            end_time: New end time in RFC3339 format. Optional.
            description: New description. Optional.
            location: New location. Optional.
            attendees: New comma-separated attendee emails (replaces existing). Optional.
            timezone: New timezone. Optional.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _calendar_oauth, "Google Calendar")
            if access_token is None:
                return "Authorization was declined by the user."

            # First, get the existing event
            existing = await call_calendar_api_get(
                access_token,
                f"calendars/{calendar_id}/events/{event_id}"
            )

            # Update fields
            if summary is not None:
                existing["summary"] = summary
            if description is not None:
                existing["description"] = description
            if location is not None:
                existing["location"] = location

            # Handle time updates
            if start_time is not None:
                tz = timezone or existing.get("start", {}).get("timeZone", "UTC")
                if "date" in existing.get("start", {}):
                    existing["start"] = {"date": start_time}
                else:
                    existing["start"] = {"dateTime": start_time, "timeZone": tz}

            if end_time is not None:
                tz = timezone or existing.get("end", {}).get("timeZone", "UTC")
                if "date" in existing.get("end", {}):
                    existing["end"] = {"date": end_time}
                else:
                    existing["end"] = {"dateTime": end_time, "timeZone": tz}

            # Handle attendees (replace if specified)
            if attendees is not None:
                if attendees:
                    existing["attendees"] = [
                        {"email": e.strip()} for e in attendees.split(",") if e.strip()
                    ]
                else:
                    existing["attendees"] = []

            result = await call_calendar_api_put(
                access_token,
                f"calendars/{calendar_id}/events/{event_id}",
                data=existing
            )

            return json.dumps({
                "success": True,
                "message": "Event updated successfully",
                "event": _format_event_response(result),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error updating event: {e}")
            return f"Error updating event: {str(e)}"

    @mcp.tool()
    async def delete_event(
        event_id: str,
        calendar_id: str = "primary",
        send_notifications: bool = False,
        ctx: Context = None,
    ) -> str:
        """Delete a calendar event.

        Args:
            event_id: The event ID to delete.
            calendar_id: Calendar ID containing the event. Default: primary.
            send_notifications: Send cancellation notifications to attendees. Default: False.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _calendar_oauth, "Google Calendar")
            if access_token is None:
                return "Authorization was declined by the user."

            # Build endpoint with query param
            endpoint = f"calendars/{calendar_id}/events/{event_id}"
            if send_notifications:
                endpoint += "?sendUpdates=all"

            await call_calendar_api_delete(access_token, endpoint)

            return json.dumps({
                "success": True,
                "message": "Event deleted successfully",
                "event_id": event_id,
                "notifications_sent": send_notifications,
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error deleting event: {e}")
            return f"Error deleting event: {str(e)}"

    @mcp.tool()
    async def quick_add_event(
        text: str,
        calendar_id: str = "primary",
        ctx: Context = None,
    ) -> str:
        """Create an event from natural language text.

        Google Calendar will parse the text to extract event details.
        Examples:
        - "Meeting with John tomorrow at 3pm"
        - "Dinner at 7pm on Friday at Italian Restaurant"
        - "Team standup every Monday at 9am"

        Args:
            text: Natural language description of the event.
            calendar_id: Calendar ID to create event in. Default: primary.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _calendar_oauth, "Google Calendar")
            if access_token is None:
                return "Authorization was declined by the user."

            result = await call_calendar_api_post(
                access_token,
                f"calendars/{calendar_id}/events/quickAdd",
                params={"text": text}
            )

            return json.dumps({
                "success": True,
                "message": "Event created from text",
                "input_text": text,
                "event": _format_event_response(result),
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error quick adding event: {e}")
            return f"Error quick adding event: {str(e)}"

    @mcp.tool()
    async def check_availability(
        time_min: str,
        time_max: str,
        calendars: Optional[str] = None,
        timezone: str = "UTC",
        ctx: Context = None,
    ) -> str:
        """Check free/busy status for calendars.

        Returns busy time slots within the specified time range.
        Useful for finding available meeting times.

        Args:
            time_min: Start of time range in RFC3339 format (e.g., 2024-01-15T09:00:00Z).
            time_max: End of time range in RFC3339 format (e.g., 2024-01-15T18:00:00Z).
            calendars: Comma-separated calendar IDs to check. Default: primary calendar.
            timezone: Timezone for the query. Default: UTC.
        """
        try:
            access_token = await get_token_with_elicitation(ctx, _calendar_oauth, "Google Calendar")
            if access_token is None:
                return "Authorization was declined by the user."

            # Parse calendar IDs
            calendar_ids = ["primary"]
            if calendars:
                calendar_ids = [c.strip() for c in calendars.split(",") if c.strip()]

            request_body = {
                "timeMin": time_min,
                "timeMax": time_max,
                "timeZone": timezone,
                "items": [{"id": cal_id} for cal_id in calendar_ids],
            }

            data = await call_calendar_api_post(
                access_token,
                "freeBusy",
                data=request_body
            )

            # Format response
            calendars_result = {}
            for cal_id, cal_data in data.get("calendars", {}).items():
                busy_slots = cal_data.get("busy", [])
                errors = cal_data.get("errors", [])

                calendars_result[cal_id] = {
                    "busy_slots": [
                        {"start": slot.get("start"), "end": slot.get("end")}
                        for slot in busy_slots
                    ],
                    "busy_count": len(busy_slots),
                    "errors": errors,
                }

            return json.dumps({
                "time_range": {
                    "start": time_min,
                    "end": time_max,
                    "timezone": timezone,
                },
                "calendars": calendars_result,
            }, ensure_ascii=False, indent=2)

        except Exception as e:
            logger.error(f"[Tool] Error checking availability: {e}")
            return f"Error checking availability: {str(e)}"

    logger.info("[Calendar] Registered 8 calendar tools: list_calendars, list_events, get_event, create_event, update_event, delete_event, quick_add_event, check_availability")
