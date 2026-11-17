"""Pluggable storage for sample photos (local disk or Azure Blob)."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Protocol

from azure.core.exceptions import ResourceNotFoundError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import ContainerClient, ContentSettings

from backend.config.settings import Settings


def photo_blob_name(sample_id: str, filename: str | None) -> str:
    stem = Path(filename or "photo").stem
    ext = Path(filename or "photo").suffix or ".jpg"
    return f"{sample_id}/{stem}_{uuid.uuid4().hex[:8]}{ext}"


class PhotoStore(Protocol):
    def save(
        self, sample_id: str, filename: str | None, content: bytes, content_type: str
    ) -> str:
        """Store a photo and return the reference kept in file_path."""
        ...

    def delete(self, ref: str) -> None:
        """Remove a photo; a no-op when the ref does not exist."""
        ...

    def exists(self, ref: str) -> bool: ...


class LocalPhotoStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def save(
        self, sample_id: str, filename: str | None, content: bytes, content_type: str
    ) -> str:
        path = self.root / photo_blob_name(sample_id, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return str(path)

    def delete(self, ref: str) -> None:
        path = Path(ref)
        if path.is_file():
            path.unlink()

    def exists(self, ref: str) -> bool:
        return Path(ref).is_file()


class BlobPhotoStore:
    def __init__(self, container: ContainerClient) -> None:
        self.container = container

    def save(
        self, sample_id: str, filename: str | None, content: bytes, content_type: str
    ) -> str:
        name = photo_blob_name(sample_id, filename)
        self.container.upload_blob(
            name=name,
            data=content,
            content_settings=ContentSettings(content_type=content_type),
        )
        return name

    def delete(self, ref: str) -> None:
        try:
            self.container.delete_blob(ref)
        except ResourceNotFoundError:
            pass

    def exists(self, ref: str) -> bool:
        return self.container.get_blob_client(ref).exists()


def get_photo_store(settings: Settings) -> PhotoStore:
    if settings.photo_storage == "blob":
        container = ContainerClient(
            account_url=settings.azure_storage_account_url,
            container_name=settings.azure_photo_container,
            credential=DefaultAzureCredential(),
        )
        return BlobPhotoStore(container)
    return LocalPhotoStore(Path(settings.sample_photos_dir))
