#!/usr/bin/env python3
"""Move sample photos from local/SharePoint paths into the photo store.

Re-runnable: rows whose file_path is already a store reference are skipped.
Source files are never deleted or altered. The target database and photo
store are printed first; --apply refuses unless PHOTO_STORAGE=blob.

Usage (run from project root; dry run unless --apply):
  python scripts/migrate_photos_to_blob.py [--apply] [--map OLD=NEW ...]
"""
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import click
from sqlalchemy.orm import Session

# is_local_ref is re-exported here; verify_migration.py and tests import it.
from backend.services.photo_storage import PhotoStore, is_local_ref
from database.models.samples import SamplePhotos

__all__ = ["MigrationReport", "is_local_ref", "migrate_photos", "resolve_source"]


@dataclass
class MigrationReport:
    moved: int = 0
    skipped: int = 0
    missing: list[tuple[int, str]] = field(default_factory=list)
    failed: list[tuple[int, str, str]] = field(default_factory=list)


def _norm(path: str) -> str:
    return path.replace("\\", "/").rstrip("/")


def resolve_source(file_path: str, prefix_map: dict[str, str]) -> Path:
    """Apply the first matching prefix (case-insensitive); else use as-is."""
    norm = _norm(file_path)
    for old, new in prefix_map.items():
        old_norm = _norm(old)
        if norm.lower() == old_norm.lower() or norm.lower().startswith(
            old_norm.lower() + "/"
        ):
            rest = [p for p in norm[len(old_norm):].split("/") if p]
            return Path(new).joinpath(*rest)
    return Path(file_path)


def migrate_photos(
    db: Session,
    store: PhotoStore,
    prefix_map: dict[str, str],
    dry_run: bool,
) -> MigrationReport:
    report = MigrationReport()
    rows = db.query(SamplePhotos).order_by(SamplePhotos.id).all()
    for row in rows:
        if not is_local_ref(row.file_path):
            report.skipped += 1
            continue
        source = resolve_source(row.file_path, prefix_map)
        if not source.is_file():
            report.missing.append((row.id, row.file_path))
            continue
        if not dry_run:
            try:
                content = source.read_bytes()
            except OSError as exc:
                report.failed.append((row.id, row.file_path, str(exc)))
                continue
            original = row.file_path
            try:
                ref = store.save(
                    row.sample_id,
                    row.file_name or source.name,
                    content,
                    row.file_type or "image/jpeg",
                )
            except Exception as exc:
                report.failed.append((row.id, original, str(exc)))
                continue
            try:
                row.file_path = ref
                db.commit()
            except Exception as exc:
                db.rollback()
                report.failed.append((row.id, original, str(exc)))
                continue
        report.moved += 1
    return report


@click.command()
@click.option("--apply", "apply_", is_flag=True,
              help="Write changes (default: dry run).")
@click.option("--map", "maps", multiple=True, metavar="OLD=NEW",
              help="Remap a path prefix; repeatable.")
def main(apply_: bool, maps: tuple[str, ...]) -> None:
    from backend.config.settings import get_settings
    from backend.services import photo_storage
    from database import database

    prefix_map = {}
    for item in maps:
        old, sep, new = item.partition("=")
        if not sep or not old or not new:
            raise click.BadParameter(f"expected OLD=NEW, got {item!r}")
        prefix_map[old] = new

    settings = get_settings()
    url = database.engine.url
    click.echo(f"database: host={url.host} database={url.database} "
               f"user={url.username} (password masked)")
    if settings.photo_storage == "blob":
        click.echo(f"photo store: blob {settings.azure_storage_account_url} "
                   f"container={settings.azure_photo_container}")
    else:
        click.echo(f"photo store: local {settings.sample_photos_dir}")
    if apply_ and settings.photo_storage != "blob":
        raise click.ClickException(
            "--apply needs PHOTO_STORAGE=blob; refusing to migrate into a "
            "local store."
        )

    store = photo_storage.get_photo_store(settings)
    db = database.SessionLocal()
    try:
        report = migrate_photos(db, store, prefix_map, dry_run=not apply_)
    finally:
        db.close()

    verb = "moved" if apply_ else "would move"
    click.echo(f"{verb}: {report.moved}  skipped: {report.skipped}  "
               f"missing: {len(report.missing)}  failed: {len(report.failed)}")
    for photo_id, path in report.missing:
        click.echo(f"MISSING id={photo_id} {path}", err=True)
    for photo_id, path, err in report.failed:
        click.echo(f"FAILED id={photo_id} {path}: {err}", err=True)
    if report.missing or report.failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
