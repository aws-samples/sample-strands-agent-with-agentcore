---
name: google-calendar
description: View, create, update, and delete calendar events
---

# Google Calendar

## Available Tools

- **list_calendars()**: List all user's calendars (primary, shared, subscribed).

- **list_events(calendar_id?, max_results?, time_min?, time_max?, query?, show_deleted?)**: List calendar events.
  - `calendar_id` (string, optional, default: "primary"): Calendar ID
  - `max_results` (integer, optional, default: 10, max: 100): Maximum events
  - `time_min` (string, optional, default: now): Start time in RFC3339 format (e.g., "2024-01-01T00:00:00Z")
  - `time_max` (string, optional): End time in RFC3339 format
  - `query` (string, optional): Free text search
  - `show_deleted` (boolean, optional, default: false): Include deleted events

- **get_event(event_id, calendar_id?)**: Get detailed information about a specific event.
  - `event_id` (string, required): Event ID (from list_events)
  - `calendar_id` (string, optional, default: "primary")

- **create_event(summary, start_time, end_time, calendar_id?, description?, location?, attendees?, timezone?, all_day?, reminder_minutes?)**: Create a new event.
  - `summary` (string, required): Event title
  - `start_time` (string, required): RFC3339 format (e.g., "2024-01-15T09:00:00") or date "YYYY-MM-DD" for all-day
  - `end_time` (string, required): RFC3339 format or date for all-day
  - `calendar_id` (string, optional, default: "primary")
  - `description` (string, optional): Event description/notes
  - `location` (string, optional): Event location
  - `attendees` (string, optional): Comma-separated email addresses
  - `timezone` (string, optional, default: "UTC"): Timezone (e.g., "Asia/Seoul", "America/New_York")
  - `all_day` (boolean, optional, default: false): Create all-day event (use YYYY-MM-DD for times)
  - `reminder_minutes` (string, optional): Comma-separated reminder times in minutes (e.g., "10,30,60")

- **update_event(event_id, calendar_id?, summary?, start_time?, end_time?, description?, location?, attendees?, timezone?)**: Update an existing event. Only specified fields are changed.
  - `event_id` (string, required)
  - `calendar_id` (string, optional, default: "primary")
  - Other parameters are optional — only provide fields to change

- **delete_event(event_id, calendar_id?, send_notifications?)**: Delete an event.
  - `event_id` (string, required)
  - `calendar_id` (string, optional, default: "primary")
  - `send_notifications` (boolean, optional, default: false): Send cancellation to attendees

- **quick_add_event(text, calendar_id?)**: Create event from natural language text.
  - `text` (string, required): Natural language description (e.g., "Meeting with John tomorrow at 3pm", "Team standup every Monday at 9am")
  - `calendar_id` (string, optional, default: "primary")

- **check_availability(time_min, time_max, calendars?, timezone?)**: Check free/busy status.
  - `time_min` (string, required): Start of range in RFC3339 format
  - `time_max` (string, required): End of range in RFC3339 format
  - `calendars` (string, optional): Comma-separated calendar IDs (default: primary)
  - `timezone` (string, optional, default: "UTC")

## Usage Guidelines

- Time format: RFC3339 — `2024-01-15T09:00:00Z` (UTC) or `2024-01-15T09:00:00+09:00` (with timezone).
- All-day events: use date format `YYYY-MM-DD` with `all_day=true`.
- Default calendar is `"primary"`.

## Common Operations

**Schedule a meeting**: Use `create_event` with `attendees` parameter for full control over time, description, and reminders.

**Find available time**: Call `check_availability` with the relevant calendar IDs and time range before creating events to avoid conflicts.

**Quick scheduling**: `quick_add_event` accepts natural language (e.g., "Lunch with Sarah tomorrow at noon"). Convenient but less precise than `create_event`.

**Reschedule**: Use `update_event` with new `start_time` and `end_time`. Only the fields you provide will be changed.
