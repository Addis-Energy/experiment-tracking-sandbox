#!/usr/bin/env python3
"""Move sample photos from local/SharePoint paths into the photo store.

Re-runnable: rows whose file_path is already a store reference are skipped.
Source files are never deleted or altered.

Usage (run from project root; dry run unless --apply):
  python scripts/migrate_photos_to_blob.py [--apply] [--map OLD=NEW ...]
"""
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import click
from sqlalchemy.orm import Session

from backend.services.photo_storage import PhotoStore
from database.models.samples import SamplePhotos

_DRIVE_RE = re.compile(r"^[A-Za-z]:[\/]")


@dataclass
class MigrationReport:
    moved: int = 0
    skipped: int = 0
    missing: list[tuple[int, str]] = field(default_factory=list)


def is_local_ref(ref: str) -> bool:
    """True for a filesystem path; blob names never match."""
    return bool(_DRIVE_RE.match(ref)) or "\\" in ref or ref.startswith("/")


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
            ref = store.save(
                row.sample_id,
                row.file_name or source.name,
                source.read_bytes(),
                row.file_type or "image/jpeg",
            )
            row.file_path = ref
            db.commit()
        report.moved += 1
    return report


@click.command()
@click.option("--apply", "apply_", is_flag=True,
              help="Write changes (default: dry run).")
@click.option("--map", "maps", multiple=True, metavar="OLD=NEW",
              help="Remap a path prefix; repeatable.")
def main(apply_: bool, maps: tuple[str, ...]) -> None:
    from backend.config.settings import get_settings
    from backend.services.photo_storage import get_photo_store
    from database.database import SessionLocal

    prefix_map = {}
    for item in maps:
        old, sep, new = item.partition("=")
        if not sep or not old or not new:
            raise click.BadParameter(f"expected OLD=NEW, got {item!r}")
        prefix_map[old] = new

    store = get_photo_store(get_settings())
    db = SessionLocal()
    try:
        report = migrate_photos(db, store, prefix_map, dry_run=not apply_)
    finally:
        db.close()

    verb = "moved" if apply_ else "would move"
    click.echo(f"{verb}: {report.moved}  skipped: {report.skipped}  "
               f"missing: {len(report.missing)}")
    for photo_id, path in report.missing:
        click.echo(f"MISSING id={photo_id} {path}", err=True)
    if report.missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
