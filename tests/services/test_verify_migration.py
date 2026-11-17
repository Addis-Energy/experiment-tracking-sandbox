from tests.api.conftest import reporting_views  # noqa: F401

from database.event_listeners import _VIEWS
from scripts.verify_migration import diff, snapshot


def test_snapshot_on_test_db(db_session, reporting_views):  # noqa: F811
    snap = snapshot(db_session.connection())
    assert "experiments" in snap["tables"]
    assert isinstance(snap["timezone"], str) and snap["timezone"]
    for name, _ in _VIEWS:
        assert name in snap["views"]
    assert snap["photos_unresolved"] is None


def test_snapshot_flags_unresolved_photos(db_session, reporting_views):  # noqa: F811
    snap = snapshot(db_session.connection(), check_photo_blob=lambda ref: False)
    assert isinstance(snap["photos_unresolved"], list)


def _clean():
    return {
        "tables": {"experiments": 3, "samples": 7},
        "alembic": "abc",
        "views": {"v_one": True},
        "timezone": "America/New_York",
        "photos_unresolved": [],
    }


def test_diff_clean():
    assert diff(_clean(), _clean()) == []


def test_diff_flags_count_view_tz_photos():
    after = _clean()
    after["tables"]["samples"] = 6
    after["views"]["v_one"] = False
    after["timezone"] = "UTC"
    after["photos_unresolved"] = [5]
    problems = diff(_clean(), after)
    assert len(problems) == 4
    text = "\n".join(problems)
    for needle in ("samples", "v_one", "UTC", "5"):
        assert needle in text


def test_diff_flags_alembic_mismatch():
    after = _clean()
    after["alembic"] = "def"
    assert any("alembic" in p for p in diff(_clean(), after))
