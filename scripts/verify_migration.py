#!/usr/bin/env python3
"""Snapshot a database and diff two snapshots to prove a migration lost nothing.

Usage (run from project root; uses DATABASE_URL):
  python scripts/verify_migration.py snapshot --out before.json [--check-blobs]
  python scripts/verify_migration.py diff before.json after.json
"""
import json
import os
import sys
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import click
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Connection

from scripts.migrate_photos_to_blob import is_local_ref

EXPECTED_TIMEZONE = "America/New_York"


def snapshot(
    conn: Connection,
    check_photo_blob: Callable[[str], bool] | None = None,
) -> dict:
    from database import Base
    from database.event_listeners import _VIEWS

    prep = conn.dialect.identifier_preparer
    tables = {}
    for table in Base.metadata.sorted_tables:
        tables[table.name] = conn.execute(
            text(f"SELECT count(*) FROM {prep.quote(table.name)}")
        ).scalar()

    alembic = None
    if inspect(conn).has_table("alembic_version"):
        alembic = conn.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar()

    views = {}
    for name, _ in _VIEWS:
        try:
            with conn.begin_nested():
                conn.execute(
                    text(f"SELECT 1 FROM {prep.quote(name)} LIMIT 1")
                ).fetchall()
            views[name] = True
        except Exception:
            views[name] = False

    timezone = conn.execute(text("SHOW timezone")).scalar()

    photos_unresolved = None
    if check_photo_blob is not None:
        rows = conn.execute(
            text("SELECT id, file_path FROM sample_photos ORDER BY id")
        ).all()
        photos_unresolved = [
            pid
            for pid, ref in rows
            if is_local_ref(ref) or not check_photo_blob(ref)
        ]

    return {
        "tables": tables,
        "alembic": alembic,
        "views": views,
        "timezone": timezone,
        "photos_unresolved": photos_unresolved,
    }


def diff(before: dict, after: dict) -> list[str]:
    problems = []
    for name in sorted(set(before["tables"]) | set(after["tables"])):
        b = before["tables"].get(name)
        a = after["tables"].get(name)
        if a != b:
            problems.append(f"row count differs for {name}: {b} -> {a}")
    if before["alembic"] != after["alembic"]:
        problems.append(
            f"alembic version mismatch: {before['alembic']} -> {after['alembic']}"
        )
    for name, ok in after["views"].items():
        if not ok:
            problems.append(f"view not selectable: {name}")
    if after["timezone"] != EXPECTED_TIMEZONE:
        problems.append(
            f"timezone is {after['timezone']}, expected {EXPECTED_TIMEZONE}"
        )
    if after.get("photos_unresolved"):
        problems.append(f"unresolved photo ids: {after['photos_unresolved']}")
    return problems


@click.group()
def cli() -> None:
    pass


@cli.command("snapshot")
@click.option("--out", required=True, type=click.Path(dir_okay=False))
@click.option("--check-blobs", is_flag=True,
              help="Verify each photo ref exists in the photo store.")
def snapshot_cmd(out: str, check_blobs: bool) -> None:
    checker = None
    if check_blobs:
        from backend.config.settings import get_settings
        from backend.services.photo_storage import get_photo_store

        checker = get_photo_store(get_settings()).exists
    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.connect() as conn:
        snap = snapshot(conn, checker)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(snap, fh, indent=2, sort_keys=True)
    click.echo(f"wrote {out}")


@cli.command("diff")
@click.argument("before", type=click.Path(exists=True, dir_okay=False))
@click.argument("after", type=click.Path(exists=True, dir_okay=False))
def diff_cmd(before: str, after: str) -> None:
    with open(before, encoding="utf-8") as fh:
        b = json.load(fh)
    with open(after, encoding="utf-8") as fh:
        a = json.load(fh)
    problems = diff(b, a)
    if problems:
        for p in problems:
            click.echo(p)
        sys.exit(1)
    click.echo("OK")


if __name__ == "__main__":
    cli()
