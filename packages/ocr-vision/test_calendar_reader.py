"""Tests de files/calendar_reader.py : helpers purs puis lecture d'un vrai .ics
(avec expansion RRULE) — AMELIORATIONS 2.3, le module le plus rentable a couvrir."""

from datetime import date, datetime

from files.calendar_reader import (
    _is_all_day,
    _parse_window_date,
    _text,
    _to_iso,
    read_calendar,
)


class _Prop:
    """Imite une propriete icalendar (valeur dans `.dt`)."""

    def __init__(self, dt):
        self.dt = dt


def test_parse_window_date_accepte_date_et_datetime_iso():
    assert _parse_window_date("2026-10-07") == date(2026, 10, 7)
    assert _parse_window_date("2026-10-07T09:30:00Z") == date(2026, 10, 7)


def test_parse_window_date_rejette_le_vide_et_l_invalide():
    assert _parse_window_date(None) is None
    assert _parse_window_date("") is None
    assert _parse_window_date("demain") is None


def test_to_iso_et_journee_entiere():
    timed = {"DTSTART": _Prop(datetime(2026, 10, 7, 9, 30))}
    all_day = {"DTSTART": _Prop(date(2026, 10, 7))}
    assert _to_iso(timed, "DTSTART") == "2026-10-07T09:30:00"
    assert _to_iso(all_day, "DTSTART") == "2026-10-07"
    assert _to_iso(timed, "DTEND") is None
    assert _is_all_day(all_day) is True
    assert _is_all_day(timed) is False
    assert _is_all_day({}) is False


def test_text_tronque_au_plafond():
    assert _text({"SUMMARY": "  Réunion  "}, "SUMMARY") == "Réunion"
    assert _text({}, "SUMMARY") == ""
    assert _text({"DESCRIPTION": "x" * 10}, "DESCRIPTION", limit=4) == "xxxx…"


ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//CatDesk//test//FR
BEGIN:VEVENT
UID:hebdo@test
DTSTART:20261005T090000
DTEND:20261005T093000
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Point d'équipe
LOCATION:Salle 2
END:VEVENT
BEGIN:VEVENT
UID:conge@test
DTSTART;VALUE=DATE:20261012
DTEND;VALUE=DATE:20261013
SUMMARY:Congé
END:VEVENT
END:VCALENDAR
"""


def test_read_calendar_deploie_les_recurrences_dans_la_fenetre(tmp_path):
    ics = tmp_path / "agenda.ics"
    ics.write_text(ICS, encoding="utf-8")

    result = read_calendar(str(ics), start="2026-10-05", end="2026-10-20")

    summaries = [e["summary"] for e in result["events"]]
    # 3 occurrences hebdomadaires (5, 12, 19 oct.) + le congé, triés par début.
    assert summaries.count("Point d'équipe") == 3
    assert "Congé" in summaries
    starts = [e["start"] for e in result["events"]]
    assert starts == sorted(starts)
    conge = next(e for e in result["events"] if e["summary"] == "Congé")
    assert conge["allDay"] is True
    assert result["from"] == "2026-10-05"
    assert result["to"] == "2026-10-20"
    assert result["truncated"] is False


def test_read_calendar_respecte_la_limite(tmp_path):
    ics = tmp_path / "agenda.ics"
    ics.write_text(ICS, encoding="utf-8")

    result = read_calendar(str(ics), start="2026-10-01", days=60, limit=2)

    assert result["count"] == 5
    assert len(result["events"]) == 2
    assert result["truncated"] is True
