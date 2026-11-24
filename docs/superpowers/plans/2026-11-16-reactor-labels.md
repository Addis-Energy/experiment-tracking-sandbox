# Reactor Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show and accept the reactor slot label (`R07`, `P03`, `CF02`) in the data export, the Master Results sheet and the experiment list, where today only the bare number appears.

**Architecture:** `experimental_conditions.reactor_slot` already holds the label, derived on every ORM write by `database/reactor_slot.py`. This plan adds two small pure helpers there and surfaces the stored label in three places. No schema, view or migration change.

**Tech Stack:** FastAPI, SQLAlchemy, openpyxl, pandas (parser), React 18 + TypeScript + React Query, pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-reactor-labels-design.md`

## Global Constraints

- No schema change, no Alembic migration, no change to any view in `database/event_listeners.py::_VIEWS`.
- Nothing under `database/models/` changes.
- `backend/services/bulk_uploads/master_bulk_upload.py` is a locked parser; Mat authorized this one change (optional `Reactor` column, check only) on 2026-11-16. Touch nothing else in `backend/services/bulk_uploads/`.
- The Master Results upload never writes `reactor_number`, `reactor_series` or `reactor_slot`, and a reactor cell never produces an error or rejects a row.
- The label mapping has one definition: `database/reactor_slot.py`. Do not re-derive a label anywhere else; read `reactor_slot` or call that module.
- Run pytest with `.venv/Scripts/python -m pytest <path>`; never two pytest processes at once (shared `experiments_test` database).
- Never start, stop or restart uvicorn or Vite.
- No new packages.
- Commits: `[feat] <imperative, under 50 chars>` with the body lines `- Tests added: yes/no` and `- Docs updated: yes/no`, ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Write the message to a scratch file and use `git commit -F <file>`.
- Edit docs under `docs/` with the Write/Edit tools (a hook mirrors them to `docs/project_context/`); never write to `docs/project_context/` directly.

## Review Focus

1. **A partly typed filter (`P`, `R0`, `abc`) in the Reactor box.** The list must not flash an error on each keystroke: the frontend sends `reactor` only when the text is a complete label or number. Test in Task 5.
2. **A decimal reactor cell (`7.5`) on the Master Results sheet.** `int(7.5)` is 7; it must be reported as unreadable, not compared as 7. Test in Task 3.
3. **A reactor cell on a row of a merged vial-day.** The merged cell view drops unknown columns, so the check must read each sheet row's own cell before merging. Test in Task 3.
4. **`0` or a negative number as a reactor cell or filter.** Not a slot: unreadable on the sheet, 422 on the API. Tests in Tasks 3 and 4.
5. **A legacy experiment with `reactor_number` set and `reactor_slot` NULL (Autoclave).** The export and list show the bare number, and the `reactor=3` filter still finds it. Tests in Tasks 2 and 4.

---

### Task 1: Slot helpers

**Files:**
- Modify: `database/reactor_slot.py` (append after `series_for_label`)
- Test: `tests/test_reactor_slot.py`

**Interfaces:**
- Produces:
  - `slot_label(prefix: str, number: int) -> str | None` — public wrapper over `_format_slot`; `slot_label("P", 3) == "P03"`, `None` for `number <= 0`.
  - `parse_reactor_reference(value: object) -> tuple[int, str | None]` — like `parse_reactor_cell`, but raises `ValueError` for a non-whole number (`7.5`, `"7.5"`), for `number <= 0`, and for `bool`. A whole float (`7.0`) is accepted.
  - `reactor_reference_matches(number: int, prefix: str | None, stored_number: int | None, stored_slot: str | None) -> bool` — with a prefix: `slot_label(prefix, number) == stored_slot`; without: `number == stored_number`.

- [ ] **Step 1: Write the failing tests** in `tests/test_reactor_slot.py`

```python
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
```

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/test_reactor_slot.py -q` — expect ImportError on the three names.
- [ ] **Step 3: Implement the three functions.** `parse_reactor_reference` delegates to `parse_reactor_cell` after the whole-number and bool guards, then rejects `number <= 0`. Update the module docstring's "imported by" list in later tasks, not here.
- [ ] **Step 4: Run the same command** — expect all pass.
- [ ] **Step 5: Commit** `[feat] Add reactor reference helpers`. Include the spec and this plan in this first commit (`docs/superpowers/specs/2026-11-16-reactor-labels-design.md`, `docs/superpowers/plans/2026-11-16-reactor-labels.md`, plus their `docs/project_context/` mirrors if the hook made any).

---

### Task 2: Export shows the label

**Files:**
- Modify: `backend/services/experiment_export.py` (`CONDITION_COLUMNS` line 180, `condition_rows` ~433, `EXPERIMENT_COLUMNS` line 689, `build_selection_workbook` ~705)
- Modify: `docs/api/API_REFERENCE.md` (export column table near line 482)
- Test: `tests/api/test_experiment_export.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: both column lists carry `("reactor", "Reactor")` in place of `("reactor_number", "Reactor number")`. Row dicts gain a `reactor` key: `reactor_slot` when set, else `str(reactor_number)` when set, else `None`. Always text, so the Excel column has one type.

- [ ] **Step 1: Write the failing tests.** Extend the `_experiment` helper with optional `reactor_series=None` and `reactor_number=3` keyword arguments (defaults keep existing tests unchanged). Seed four experiments in one series or selection: HPHT with `reactor_series="P"`, HPHT default, Core Flood, and `experiment_type="Autoclave"`. Read the workbook back with openpyxl and assert, on the **Conditions** tab of the single-series export and on both the **Experiments** and **Conditions** tabs of the selection export:

```python
assert header_row.count("Reactor") == 1 and "Reactor number" not in header_row
assert reactor_by_id == {"<parr id>": "P03", "<hpht id>": "R03",
                         "<cf id>": "CF03", "<autoclave id>": "3"}
```

Add one experiment with no conditions reactor (`reactor_number=None`) and assert its cell is empty.

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/api/test_experiment_export.py -q` — expect the new tests to fail on the header.
- [ ] **Step 3: Implement.** One module-level helper `_reactor_display(slot: str | None, number: int | None) -> str | None`. `condition_rows` sets `row["reactor"]` from the view's own `reactor_slot` / `reactor_number`. `build_selection_workbook` reads `v_experiments` (no slot column), so fetch `experiment_id, reactor_slot` from `v_experiment_conditions` for the same IDs in one query and set `reactor` on each experiment row. Do not alter any view.
- [ ] **Step 4: Run the same command** — expect all pass, including the pre-existing tests.
- [ ] **Step 5: Update `docs/api/API_REFERENCE.md`:** the export table's "Reactor number" becomes "Reactor" with a note that it holds the slot label (`R07` / `P03` / `CF02`), the bare number for legacy rows with no slot, and that an Excel lookup on the old header text needs updating.
- [ ] **Step 6: Commit** `[feat] Export reactor slot label`.

---

### Task 3: Master Results reactor check

**Files:**
- Modify: `backend/services/bulk_uploads/master_bulk_upload.py`
- Modify: `docs/user_guide/BULK_UPLOADS.md` (section 1, the `Dashboard` column table), `docs/upload_templates/master_bulk_upload.md`
- Test: `tests/services/bulk_uploads/test_master_bulk_upload.py`

**Interfaces:**
- Consumes: `parse_reactor_reference`, `reactor_reference_matches`, `slot_label` from `database/reactor_slot.py` (Task 1).
- Produces: no API shape change; new lines in `MasterUploadResult.warnings`.

Behaviour to build:

- Module constant `_REACTOR = "Reactor"`. `_HEADER_ALIASES` gains `"reactor"`, `"reactor number"`, `"reactor #"` → `_REACTOR`.
- In the Phase 1 loop (where `bad_tube_rows` is filled, ~line 926), when the sheet has the column, record each resolved row's own cell: blank (None, NaN, whitespace-only) is ignored; a cell `parse_reactor_reference` rejects goes to `bad_reactor_rows: List[int]`; a readable one goes to `reactor_cells: Dict[int, Tuple[int, Optional[str], str]]` keyed by `row_num`, holding `(number, prefix, text as written)`. This is before the merge on purpose: `_merge_group`'s cell view does not carry this column, and `_merge_group` must not change.
- In Phase 2, after `savepoint.commit()` succeeds for a vial-day, for each `row_num` in that entry's `rows` that has a `reactor_cells` entry, compare against the conditions row of the experiment the result was written to (`ExperimentalConditions` by `experiment_fk == exp_result.experiment_fk`, lowest id; cache per `experiment_fk` so a file costs one query per experiment). No conditions row counts as nothing stored. A mismatch is appended to `reactor_mismatches` as the text `"<row> (<experiment_id>): sheet <text as written>, app <stored slot, else stored number, else 'none'>"`.
- A row whose vial-day was rejected or errored is not checked (nothing was written, and the errors already name it).
- Two file-level warnings beside the tube warnings (~line 1254), each using `_rows_clause`:

```python
f"'{_REACTOR}' does not match the reactor stored for the experiment on "
f"{len(reactor_mismatches)} row(s)" + _rows_clause(reactor_mismatches)
+ ". The results were uploaded and the experiment's reactor was not changed; "
  "fix the sheet, or change the reactor on the experiment's Conditions tab."

f"'{_REACTOR}' could not be read on {len(bad_reactor_rows)} row(s)"
+ _rows_clause([str(r) for r in bad_reactor_rows])
+ ". Use a label such as R07, P03 or CF02, or a plain number. Those cells "
  "were ignored; the rest of each row was uploaded."
```

- [ ] **Step 1: Write the failing tests.** Add a builder beside `_master_excel_v3` that appends a `Reactor` column (accept the header text as a parameter). Seed conditions with `ExperimentalConditions(experiment_fk=..., experiment_id=..., experiment_type="HPHT", reactor_number=3, reactor_series="P")` and flush, so the listener sets `reactor_slot = "P03"`. Tests, each asserting the result row was created **and** the conditions row still has `reactor_number == 3`, `reactor_series == "P"`, `reactor_slot == "P03"` afterwards:

| Test | Cell | Expect |
|---|---|---|
| `test_reactor_cell_matching_label_is_silent` | `P03` (also `p3`) | no warning mentioning `'Reactor'` |
| `test_reactor_cell_label_mismatch_warns` | `R03` | one warning containing `sheet R03, app P03` and the row number |
| `test_reactor_cell_bare_number_compares_number_only` | `3` silent; `4` warns `sheet 4, app P03` | |
| `test_reactor_cell_on_experiment_without_reactor_warns` | `R03`, Serum experiment with no reactor | `app none` |
| `test_reactor_cell_unreadable_warns_and_uploads` | `Parr 3`, `7.5`, `0` | "could not be read" warning naming the rows; no mismatch warning |
| `test_reactor_cell_blank_and_absent_column_are_silent` | blank cell; sheet with no column | no `'Reactor'` warning |
| `test_reactor_header_aliases` | headers `Reactor Number`, `reactor #` | mismatch detected the same way |
| `test_reactor_cell_checked_per_row_in_a_merged_vial_day` | two rows, same ID and Duration, complementary fields, cells `P03` and `R03` | vial-day merges into one result; exactly one mismatch, naming the second row |
| `test_reactor_cell_never_adds_an_error` | `R03` mismatch | `errors == []` |

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/services/bulk_uploads/test_master_bulk_upload.py -q` — expect the new tests to fail (mismatch tests find no warning).
- [ ] **Step 3: Implement** as described above. Add a short comment at `_REACTOR` stating: check only, never written, authorized 2026-11-16, spec path.
- [ ] **Step 4: Run the same command** — expect all pass.
- [ ] **Step 5: Run** `.venv/Scripts/python -m pytest tests/integration/test_master_results_sync_endpoint.py tests/api/test_bulk_uploads.py -q` — expect no new failures against `develop`.
- [ ] **Step 6: Docs.** In both doc files add the optional `Reactor` column: accepted spellings, accepted cell forms, "checked against the experiment's stored reactor; a mismatch is listed under Warnings; never changes the experiment and never blocks a row; a plain number is compared on the number only, so use a label to catch an R/P mix-up". Run a repo-wide search for `Tube Number` to find any other place that lists the sheet's optional columns (template text, frontend help text) and add `Reactor` beside it wherever the list is meant to be complete. Add `master_bulk_upload.py` to the "imported by" list in the `database/reactor_slot.py` docstring.
- [ ] **Step 7: Commit** `[feat] Check reactor cell on Master Results`.

---

### Task 4: Experiment list API

**Files:**
- Modify: `backend/api/schemas/experiments.py` (`ExperimentListItem`, beside `reactor_number` at line 68)
- Modify: `backend/api/routers/experiments.py` (`_build_list_item` line 209, `list_experiments` lines 227 and 279)
- Modify: `docs/api/API_REFERENCE.md` (`GET /api/experiments` parameters and list item fields)
- Test: `tests/api/test_experiments.py`

**Interfaces:**
- Consumes: `parse_reactor_reference`, `slot_label` (Task 1).
- Produces:
  - `ExperimentListItem.reactor_slot: Optional[str] = None`.
  - Query parameter `reactor: str | None` on `GET /api/experiments`. With a prefix: `ExperimentalConditions.reactor_slot == slot_label(prefix, number)`. Without: `ExperimentalConditions.reactor_number == number`. Unreadable (including `0`): HTTP 422 with detail `"Unknown reactor '<value>'; use a label such as R07, P03 or CF02, or a number"`. Blank or whitespace-only: no filter.
  - The existing `reactor_number: int | None` parameter is unchanged.

- [ ] **Step 1: Write the failing tests.** Seed `R03` (HPHT), `P03` (HPHT, `reactor_series="P"`), `CF03` (Core Flood) and an Autoclave with `reactor_number=3`.

```python
# reactor=P3  -> only the Parr experiment
# reactor=r03 -> only the default HPHT
# reactor=CF3 -> only the Core Flood
# reactor=3   -> all four (any series, including the slot-less Autoclave)
# reactor_number=3 (old param) -> all four, unchanged
# reactor=abc and reactor=0 -> 422
# items carry reactor_slot: "P03" / "R03" / "CF03" / None
# total in the response matches the filtered count
```

- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/api/test_experiments.py -q` — expect the new tests to fail.
- [ ] **Step 3: Implement.** The filter is applied to `stmt` beside the existing `reactor_number` filter, before the grouping branch, so `total` reflects it.
- [ ] **Step 4: Run** `.venv/Scripts/python -m pytest tests/api/test_experiments.py tests/api/test_query_counts.py -q` — expect all pass (the list item reads a row already loaded, so query counts must not move).
- [ ] **Step 5: Update `docs/api/API_REFERENCE.md`** with the parameter and the field.
- [ ] **Step 6: Commit** `[feat] Filter experiment list by reactor slot`.

---

### Task 5: Frontend list column and filters

**Files:**
- Modify: `frontend/src/utils/reactorSlots.ts`, `frontend/src/api/experiments.ts` (lines ~101 and ~264), `frontend/src/pages/ExperimentList.tsx` (lines 70, 160, 415-428), `frontend/src/pages/DataExport/DataExportPage.tsx` (line 35), `frontend/src/pages/DataExport/ExportFilters.tsx` (line 60)
- Test: `frontend/src/utils/__tests__/reactorSlots.test.ts`, `frontend/src/pages/__tests__/ExperimentList.test.tsx`, `frontend/src/pages/DataExport/__tests__/DataExportPage.test.tsx`

**Interfaces:**
- Consumes: `reactor` query parameter and `reactor_slot` list field (Task 4).
- Produces: `reactorFilterParam(text: string): string | undefined` in `reactorSlots.ts` — returns the trimmed text when it matches `/^(cf|r|p)?\s*0*[1-9]\d*$/i`, otherwise `undefined`.

- [ ] **Step 1: Write the failing tests.**

```ts
// reactorSlots.test.ts
expect(reactorFilterParam('P3')).toBe('P3')
expect(reactorFilterParam(' r03 ')).toBe('r03')
expect(reactorFilterParam('7')).toBe('7')
for (const partial of ['', 'P', 'R0', 'abc', '0', 'CF', '3.5'])
  expect(reactorFilterParam(partial)).toBeUndefined()
```

`ExperimentList.test.tsx`: a row with `reactor_slot: 'P03', reactor_number: 3` renders `P03`; a row with `reactor_slot: null, reactor_number: 3` renders `3`; typing `P3` in the Reactor box calls the list API with `reactor: 'P3'` and no `reactor_number`; typing `P` sends neither.
`DataExportPage.test.tsx`: typing `CF1` in the Reactor filter sends `reactor: 'CF1'`.

- [ ] **Step 2: Run** `npx vitest run src/utils/__tests__/reactorSlots.test.ts src/pages/__tests__/ExperimentList.test.tsx src/pages/DataExport/__tests__/DataExportPage.test.tsx` from `frontend/` — expect the new tests to fail.
- [ ] **Step 3: Implement.** Add `reactor_slot: string | null` to the list item interface and `reactor?: string` to the list params. Both pages send `reactor: reactorFilterParam(text)` in place of the `parseInt` line. The list cell shows `exp.reactor_slot ?? exp.reactor_number`, keeping the existing null branch and markup. Both filter placeholders change from `Reactor #` to `Reactor` (in `ExportFilters` the aria-label follows the placeholder, so update any test that queries `Reactor #`). Add `reactor_slot` to existing test fixtures that TypeScript now flags.
- [ ] **Step 4: Run the same vitest command** — expect all pass.
- [ ] **Step 5: Run** `npm run lint` and `npm run type-check` in `frontend/` — expect exit 0 from both (baseline is zero).
- [ ] **Step 6: Commit** `[feat] Show reactor slot in list and filters`.

---

### Task 6: Whole-change verification

- [ ] **Step 1: Backend suite**, one process: `.venv/Scripts/python -m pytest tests/api tests/services tests/models tests/integration tests/test_reactor_slot.py -q`. Compare failures by test ID against the same run on `develop`; expect no new IDs. (An unscoped `pytest -q` has known unrelated failures; do not use it.)
- [ ] **Step 2: Frontend suite:** `npx vitest run` in `frontend/` — expect all pass.
- [ ] **Step 3: `git diff develop --stat`** — confirm nothing under `database/models/`, `alembic/`, or any `backend/services/bulk_uploads/` file other than `master_bulk_upload.py` changed, and that `frontend/package.json` / `package-lock.json` are untouched.
- [ ] **Step 4: Browser check** against the already-running dev servers: on `/experiments`, the Reactor column shows labels and filtering by `P3` narrows to Parr runs; on the Data Export page, a selection export downloads with a `Reactor` column holding labels. If a dev server is unreachable, report it rather than starting one.
- [ ] **Step 5:** Hand back for `/complete-task` (issue log entry, PR with `--base develop`).
