from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.services.photo_storage import LocalPhotoStore
from database.models.samples import SampleInfo, SamplePhotos
from scripts.migrate_photos_to_blob import is_local_ref, migrate_photos


def _seed(db, file_path, sample_id="S1"):
    if not db.get(SampleInfo, sample_id):
        db.add(SampleInfo(sample_id=sample_id))
        db.flush()
    row = SamplePhotos(
        sample_id=sample_id,
        file_path=file_path,
        file_name="a.jpg",
        file_type="image/jpeg",
    )
    db.add(row)
    db.commit()
    return row


def _src(tmp_path, *parts, data=b"jpegbytes"):
    p = tmp_path.joinpath("src", *parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def test_moves_local_file_and_rewrites_path(db_session, tmp_path):
    src = _src(tmp_path, "a.jpg")
    row = _seed(db_session, str(src))
    store = LocalPhotoStore(tmp_path / "dest")
    report = migrate_photos(db_session, store, {}, dry_run=False)
    assert report.moved == 1
    db_session.refresh(row)
    new = tmp_path / "dest" / "S1"
    assert row.file_path.startswith(str(new))
    assert open(row.file_path, "rb").read() == b"jpegbytes"
    assert src.exists()


def test_dry_run_changes_nothing(db_session, tmp_path):
    src = _src(tmp_path, "a.jpg")
    row = _seed(db_session, str(src))
    store = LocalPhotoStore(tmp_path / "dest")
    report = migrate_photos(db_session, store, {}, dry_run=True)
    assert report.moved == 1
    db_session.refresh(row)
    assert row.file_path == str(src)
    assert not list((tmp_path / "dest").rglob("*.jpg"))


def test_missing_file_reported_row_kept(db_session, tmp_path):
    path = str(tmp_path / "src" / "gone.jpg")
    row = _seed(db_session, path)
    store = LocalPhotoStore(tmp_path / "dest")
    report = migrate_photos(db_session, store, {}, dry_run=False)
    assert report.missing == [(row.id, path)]
    assert report.moved == 0
    db_session.refresh(row)
    assert row.file_path == path


def test_rerun_skips_blob_refs(db_session, tmp_path):
    _seed(db_session, "S1/a_1234abcd.jpg")
    store = MagicMock()
    report = migrate_photos(db_session, store, {}, dry_run=False)
    assert report.skipped == 1
    assert report.moved == 0
    store.save.assert_not_called()


def test_prefix_map_remaps_other_users_path(db_session, tmp_path):
    _src(tmp_path, "x", "a.jpg")
    _seed(db_session, r"C:\Users\Someone\OneDrive\x\a.jpg")
    store = LocalPhotoStore(tmp_path / "dest")
    pmap = {r"C:\Users\Someone\OneDrive": str(tmp_path / "src")}
    report = migrate_photos(db_session, store, pmap, dry_run=False)
    assert report.moved == 1
    assert report.missing == []


def test_is_local_ref():
    assert is_local_ref(r"C:\a\b.jpg")
    assert is_local_ref("C:/a/b.jpg")
    assert is_local_ref("/var/x.jpg")
    assert is_local_ref(r"a\b.jpg")
    assert not is_local_ref("S1/a_1234abcd.jpg")


def test_read_error_recorded_and_run_continues(db_session, tmp_path):
    bad = _src(tmp_path, "bad.jpg")
    good = _src(tmp_path, "good.jpg")
    r1 = _seed(db_session, str(bad))
    r2 = _seed(db_session, str(good))
    store = LocalPhotoStore(tmp_path / "dest")
    real = Path.read_bytes

    def fake(self):
        if self.name == "bad.jpg":
            raise PermissionError("online-only")
        return real(self)

    with patch.object(Path, "read_bytes", fake):
        report = migrate_photos(db_session, store, {}, dry_run=False)
    assert [f[0] for f in report.failed] == [r1.id]
    assert report.moved == 1
    db_session.refresh(r1)
    db_session.refresh(r2)
    assert r1.file_path == str(bad)
    assert r2.file_path != str(good)


def test_save_error_rolls_back_and_continues(db_session, tmp_path):
    a = _src(tmp_path, "a.jpg")
    b = _src(tmp_path, "b.jpg")
    r1 = _seed(db_session, str(a))
    r2 = _seed(db_session, str(b))
    store = MagicMock()
    store.save.side_effect = [RuntimeError("boom"), "S/b_12345678.jpg"]
    report = migrate_photos(db_session, store, {}, dry_run=False)
    assert len(report.failed) == 1
    assert report.failed[0][0] == r1.id
    db_session.refresh(r1)
    db_session.refresh(r2)
    assert r1.file_path == str(a)
    assert r2.file_path == "S/b_12345678.jpg"
