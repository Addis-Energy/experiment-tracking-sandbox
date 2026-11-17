from unittest.mock import MagicMock

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
