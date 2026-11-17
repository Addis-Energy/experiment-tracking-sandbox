from tests.api.conftest import reporting_views  # noqa: F401

from database.event_listeners import _VIEWS
from database.models.samples import SampleInfo, SamplePhotos
from scripts.verify_migration import diff, snapshot


def test_snapshot_on_test_db(db_session, reporting_views):  # noqa: F811
    snap = snapshot(db_session.connection())
    assert "experiments" in snap["tables"]
    assert isinstance(snap["timezone"], str) and snap["timezone"]
    for name, _ in _VIEWS:
        assert name in snap["views"]
    assert snap["photos_unresolved"] is None


def test_snapshot_flags_unresolved_photos(db_session, reporting_views):  # noqa: F811
    db_session.add(SampleInfo(sample_id="VM-1"))
    db_session.flush()
    local_path = r"C:\Users\LabPC\x\a.jpg"
    local = SamplePhotos(sample_id="VM-1", file_path=local_path)
    missing = SamplePhotos(sample_id="VM-1", file_path="VM-1/missing.jpg")
    present = SamplePhotos(sample_id="VM-1", file_path="VM-1/present.jpg")
    db_session.add_all([local, missing, present])
    db_session.flush()
    snap = snapshot(
        db_session.connection(),
        check_photo_blob=lambda ref: ref == "VM-1/present.jpg",
    )
    assert snap["photos_unresolved"] == sorted([local.id, missing.id])


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


def test_diff_flags_unchecked_photos():
    after = _clean()
    after["photos_unresolved"] = None
    problems = diff(_clean(), after)
    assert len(problems) == 1
    assert "--check-blobs" in problems[0]


def test_diff_flags_count_view_tz_photos():
    after = _clean()
    after["tables"]["samples"] = 6
    after["views"]["v_one"] = False
    after["timezone"] = "UTC"
    after["photos_unresolved"] = [5]
    problems = diff(_clean(), after)
    assert len(problems) == 4
    text = "\n".join(problems)
    for needle in ("samples", "v_one", "UTC", "unresolved photo ids: [5]"):
        assert needle in text


def test_diff_flags_alembic_mismatch():
    after = _clean()
    after["alembic"] = "def"
    assert any("alembic" in p for p in diff(_clean(), after))
