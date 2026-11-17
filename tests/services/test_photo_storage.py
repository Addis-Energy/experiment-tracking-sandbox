import re
from pathlib import Path
from unittest.mock import MagicMock, patch

from azure.core.exceptions import ResourceNotFoundError

from backend.config.settings import Settings
from backend.services.photo_storage import (
    BlobPhotoStore,
    LocalPhotoStore,
    get_photo_store,
    photo_blob_name,
)


def test_blob_name_shape():
    assert re.match(r"^S1/shot_[0-9a-f]{8}\.png$", photo_blob_name("S1", "shot.png"))
    assert re.match(r"^S1/photo_[0-9a-f]{8}\.jpg$", photo_blob_name("S1", None))


def test_local_save_and_delete(tmp_path):
    store = LocalPhotoStore(tmp_path)
    ref = store.save("S1", "a.jpg", b"x", "image/jpeg")
    assert Path(ref).read_bytes() == b"x"
    assert Path(ref).parent == tmp_path / "S1"
    store.delete(ref)
    assert not Path(ref).exists()
    store.delete(ref)


def test_blob_save_uploads_with_content_type():
    container = MagicMock()
    name = BlobPhotoStore(container).save("S1", "a.png", b"x", "image/png")
    assert name.startswith("S1/")
    container.upload_blob.assert_called_once()
    kwargs = container.upload_blob.call_args.kwargs
    assert kwargs["name"] == name
    assert kwargs["data"] == b"x"
    assert kwargs["content_settings"].content_type == "image/png"


def test_blob_delete_missing_is_noop():
    container = MagicMock()
    container.delete_blob.side_effect = ResourceNotFoundError("gone")
    BlobPhotoStore(container).delete("S1/a.jpg")


def test_exists(tmp_path):
    store = LocalPhotoStore(tmp_path)
    ref = store.save("S1", "a.jpg", b"x", "image/jpeg")
    assert store.exists(ref) is True
    store.delete(ref)
    assert store.exists(ref) is False
    container = MagicMock()
    container.get_blob_client.return_value.exists.return_value = False
    assert BlobPhotoStore(container).exists("S1/a.jpg") is False


def test_get_photo_store_local_default(tmp_path):
    settings = Settings(_env_file=None, sample_photos_dir=str(tmp_path))
    assert isinstance(get_photo_store(settings), LocalPhotoStore)


def test_get_photo_store_blob():
    settings = Settings(
        _env_file=None,
        photo_storage="blob",
        azure_storage_account_url="https://acct.blob.core.windows.net",
    )
    with patch("backend.services.photo_storage.ContainerClient") as cc, patch(
        "backend.services.photo_storage.DefaultAzureCredential"
    ):
        store = get_photo_store(settings)
    assert isinstance(store, BlobPhotoStore)
    assert cc.call_args.kwargs["container_name"] == "sample-photos"


def test_blob_delete_local_path_makes_no_container_call():
    container = MagicMock()
    BlobPhotoStore(container).delete(r"C:\x\y.jpg")
    BlobPhotoStore(container).delete("/var/x.jpg")
    assert container.mock_calls == []
