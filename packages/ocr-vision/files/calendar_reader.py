"""Read a local iCalendar (.ics) file and list events within a date window.

Recurring events (RRULE) are expanded inside the window via
`recurring_ical_events`, so "what's on my calendar next week" returns every
occurrence, not just the series master.
"""

import logging
import os
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)


def _parse_window_date(value: Optional[str]) -> Optional[date]:
    """Accept 'YYYY-MM-DD' or a longer ISO datetime; keep the date part."""
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _to_iso(component, key: str) -> Optional[str]:
    raw = component.get(key)
    if raw is None:
        return None
    dt = getattr(raw, "dt", raw)
    if isinstance(dt, (datetime, date)):
        return dt.isoformat()
    return str(dt)


def _is_all_day(component) -> bool:
    raw = component.get("DTSTART")
    if raw is None:
        return False
    dt = getattr(raw, "dt", raw)
    return isinstance(dt, date) and not isinstance(dt, datetime)


def _text(component, key: str, limit: Optional[int] = None) -> str:
    value = component.get(key)
    if value is None:
        return ""
    text = str(value).strip()
    if limit and len(text) > limit:
        return text[:limit] + "…"
    return text


def _event_dict(component) -> Dict[str, Any]:
    return {
        "summary": _text(component, "SUMMARY"),
        "start": _to_iso(component, "DTSTART"),
        "end": _to_iso(component, "DTEND"),
        "allDay": _is_all_day(component),
        "location": _text(component, "LOCATION"),
        "description": _text(component, "DESCRIPTION", limit=500),
        "status": _text(component, "STATUS"),
    }


def read_calendar(
    path: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    days: int = 30,
    limit: int = 50,
) -> Dict[str, Any]:
    try:
        from icalendar import Calendar
        import recurring_ical_events
    except ImportError:
        raise RuntimeError("icalendar not installed. Run: pip install icalendar recurring-ical-events")

    with open(path, "rb") as f:
        calendar = Calendar.from_ical(f.read())

    start_d = _parse_window_date(start) or date.today()
    end_d = _parse_window_date(end) or (start_d + timedelta(days=max(days, 1)))

    occurrences = recurring_ical_events.of(calendar).between(start_d, end_d)
    events: List[Dict[str, Any]] = [_event_dict(ev) for ev in occurrences]
    events.sort(key=lambda e: (e["start"] is None, e["start"] or ""))

    truncated = len(events) > limit
    return {
        "path": os.path.abspath(path),
        "from": start_d.isoformat(),
        "to": end_d.isoformat(),
        "count": len(events),
        "truncated": truncated,
        "events": events[:limit],
    }
