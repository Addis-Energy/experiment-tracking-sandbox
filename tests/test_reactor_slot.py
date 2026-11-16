"""Unit tests for database/reactor_slot.py — the single definition of slot identity.

Slot identity is a (series, number) pair rendered as one canonical string.
Only HPHT and Core Flood bear physical reactor occupancy (decided 2026-07-29);
every other type derives to None, which is what makes the eligibility gate
structural rather than remembered. See issue #97.
"""
from __future__ import annotations

import pytest

from database.reactor_slot import (
    derive_reactor_slot,
    is_occupancy_type,
    normalize_experiment_type,
    series_prefix,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("HPHT", "hpht"),
        ("  HPHT ", "hpht"),
        ("Core  Flood", "core flood"),
        ("SERUM", "serum"),
        (None, ""),
        ("", ""),
    ],
)
def test_normalize_experiment_type(raw, expected):
    assert normalize_experiment_type(raw) == expected


def test_normalize_experiment_type_accepts_enum_instance():
    """experiment_type is a String column, but enum instances reach these helpers
    from the parsers (parse_exp_id_validation returns ExperimentType)."""
    from database.models.enums import ExperimentType

    assert normalize_experiment_type(ExperimentType.HPHT) == "hpht"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("HPHT", "R"),
        ("hpht", "R"),
        ("Core Flood", "CF"),
        ("CORE FLOOD", "CF"),
        ("CoreFlood", "CF"),
        ("CF", "CF"),          # 1 prod row uses this spelling
        ("Serum", None),
        ("SERUM", None),
        ("Autoclave", None),   # decided 2026-07-29: not occupancy-bearing
        ("AUTO", None),
        ("Other", None),
        (None, None),
    ],
)
def test_series_prefix(raw, expected):
    assert series_prefix(raw) == expected


def test_is_occupancy_type_mirrors_series_prefix():
    assert is_occupancy_type("HPHT") is True
    assert is_occupancy_type("Core Flood") is True
    assert is_occupancy_type("Serum") is False
    assert is_occupancy_type(None) is False


@pytest.mark.parametrize(
    "number,etype,expected",
    [
        (1, "HPHT", "R01"),
        (16, "HPHT", "R16"),
        (1, "Core Flood", "CF01"),
        (3, "CF", "CF03"),
        (1, "SERUM", None),        # non-occupancy type gets no slot
        (3, "Autoclave", None),
        (None, "HPHT", None),      # no number, no slot
        (0, "HPHT", None),         # zero is not a slot — this is the R00 defect
        (-2, "HPHT", None),
        (1, None, None),           # unknown type cannot be placed in a series
    ],
)
def test_derive_reactor_slot(number, etype, expected):
    assert derive_reactor_slot(number, etype) == expected


def test_derive_reactor_slot_tolerates_float_and_string_numbers():
    """pandas hands parsers numpy floats; the conditions sheet can hand over strings."""
    assert derive_reactor_slot(5.0, "HPHT") == "R05"
    assert derive_reactor_slot("7", "HPHT") == "R07"
    assert derive_reactor_slot("not a number", "HPHT") is None


# --- Reactor references typed by a person (reactor-labels, 2026-11-16) -------

from database.reactor_slot import (  # noqa: E402
    parse_reactor_reference,
    reactor_reference_matches,
    slot_label,
)


def test_slot_label():
    assert slot_label("P", 3) == "P03"
    assert slot_label("CF", 12) == "CF12"
    assert slot_label("R", 0) is None


@pytest.mark.parametrize("value,expected", [
    ("P03", (3, "P")), ("r7", (7, "R")), (" CF2 ", (2, "CF")),
    (7, (7, None)), (7.0, (7, None)), ("7", (7, None)),
])
def test_parse_reactor_reference(value, expected):
    assert parse_reactor_reference(value) == expected


@pytest.mark.parametrize("value", [7.5, "7.5", 0, "R0", -1, "Parr 3", "", True])
def test_parse_reactor_reference_rejects(value):
    with pytest.raises(ValueError):
        parse_reactor_reference(value)


def test_reactor_reference_matches():
    assert reactor_reference_matches(3, "P", 3, "P03")
    assert not reactor_reference_matches(3, "R", 3, "P03")
    assert reactor_reference_matches(3, None, 3, "P03")      # bare number: number only
    assert not reactor_reference_matches(4, None, 3, "P03")
    assert not reactor_reference_matches(3, "R", None, None)  # nothing stored
    assert reactor_reference_matches(3, None, 3, None)        # legacy number, no slot
