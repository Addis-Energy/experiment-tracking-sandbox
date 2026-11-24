# Reactor labels in the export, the Master Results sheet and the experiment list

Date: 2026-11-16. Branch: `feat/reactor-labels`. Status: awaiting approval.

## Why

User report: "The database download has reactor number but doesn't include P or R
or other way to distinguish Parr reactors from the others." A Parr run in vessel 3
and a Yushen/Tan run in vessel 3 both export as `3`.

The label scheme the team wants (`R01`-`R16`, `P01`-`P06`, `CF01`-`CF03`) already
exists in storage since issue #147: `experimental_conditions.reactor_slot` is
derived on every write from `reactor_number`, `experiment_type` and
`reactor_series` by `database/reactor_slot.py`. The wizard, Conditions tab,
dashboard, and the New Experiments and Experiment Status uploads already use it.
Three places still show or take the bare integer. This change closes them.

## Goals

1. The export shows the slot label.
2. The Master Results sheet can carry a reactor cell, checked against the app.
3. The experiment list and Data Export filter show and accept the label.

## Non-goals

- No schema change, no migration, no view change. `reactor_number` and
  `reactor_series` stay as stored inputs; `reactor_slot` stays derived.
- The Master Results upload never writes a reactor. Assigning a vessel stays with
  the wizard, the Conditions tab, and the New Experiments / Experiment Status
  uploads, which carry the occupancy checks.
- No change to occupancy logic, the dashboard, or the two uploads that already
  accept labels.

## Anti-goals

- A results upload moving an experiment to a different vessel.
- A reactor mismatch blocking a results upload.
- A second definition of the label mapping. Everything goes through
  `database/reactor_slot.py`.

## Approaches considered

1. **Show the label at the edges (chosen, Mat 2026-11-16).** Surface the stored
   `reactor_slot` where it is missing. No schema or view work.
2. **Same, plus `reactor_slot` on `v_experiments`.** Costs a migration and the
   view-parity test chain. `v_experiment_conditions` already exposes the label
   and Power BI is retired, so nobody benefits.
3. **Store the label and retire the integer.** Non-additive migration on a locked
   model, about 130 files read `reactor_number`, and users would see the same
   result as option 1.

## Design

### Export (`backend/services/experiment_export.py`)

- On the Experiments tab (`EXPERIMENT_COLUMNS`) and the Conditions tab
  (`CONDITION_COLUMNS`), the `("reactor_number", "Reactor number")` column is
  replaced by one column headed **Reactor**. (Decided: one column, not two.)
- Value: `reactor_slot` when set; otherwise the bare `reactor_number` (legacy
  Autoclave rows carry a number and no slot); otherwise blank.
- The Conditions tab already reads `v_experiment_conditions`, which has
  `reactor_slot`. The Experiments tab reads `v_experiments`, which does not; the
  builder gets the slot for those experiment IDs from `v_experiment_conditions`
  (no view change). How it is fetched is the builder's call.
- Both workbooks are affected: the single-series export and the selection export.

### Master Results sheet (`backend/services/bulk_uploads/master_bulk_upload.py`)

Locked parser; Mat authorized this change on 2026-11-16 by choosing "check only".

- New optional `Dashboard` column **Reactor**. Aliases via `_HEADER_ALIASES`:
  `Reactor Number`, `Reactor #` (builder's call, my proposal).
- Cells are read with `parse_reactor_cell` (same reader as the other uploads):
  `R07`, `r7`, `P01`, `CF2`, or a plain `7`.
- Check only. For each row with a non-blank cell whose experiment resolved:
  - label given (`P03`): compare with the experiment's stored `reactor_slot`;
  - plain number given (`3`): compare with the stored `reactor_number` only.
  - The experiment has no stored reactor: counts as a mismatch ("app has none").
  - The cell cannot be read: reported, ignored.
- Mismatches and unreadable cells go under **Warnings**, one file-level line per
  kind, using the existing `_rows_clause` pattern (row list shown at 10 or
  fewer). Each mismatch names the row, the sheet value and the app's value.
- Never an error, never rejects or alters a row, never writes conditions. Blank
  cells and an absent column do nothing. Rows of a merged vial-day are each
  checked on their own; the cell takes no part in the merge or its conflict rule.

### Experiment list and Data Export filter

- `ExperimentListItem` gains `reactor_slot` (from the conditions row already
  loaded in `_build_list_item`); `frontend/src/api/experiments.ts` mirrors it.
- `ExperimentList.tsx` shows `reactor_slot ?? reactor_number` in the reactor
  column.
- `GET /api/experiments` gains a text filter `reactor`: `P3` / `R03` / `CF1`
  match that exact slot; a plain `3` matches `reactor_number = 3` in any series,
  as today; anything else is a 422. The existing integer `reactor_number`
  parameter stays for compatibility. `ExperimentList.tsx` and
  `DataExportPage.tsx` send `reactor` instead of parsing an int.

### Docs

`docs/user_guide/BULK_UPLOADS.md` (new column, check-only behaviour),
`docs/upload_templates/master_bulk_upload.md`, `docs/api/API_REFERENCE.md`
(`reactor` filter, `reactor_slot` on the list item), and the export column
rename wherever the export is documented.

### Tests

- Export: a Parr HPHT, a default HPHT, a Core Flood and a number-only legacy row
  give `P03`, `R03`, `CF03` and `3` on both tabs of both workbooks.
- Master Results: matching label, mismatching label, bare number match and
  mismatch, experiment with no reactor, unreadable cell, blank cell, no column.
  Each asserts that results still upload and conditions are unchanged.
- List API: `reactor=P3` vs `reactor=3`, bad value 422, `reactor_slot` in items.
- Frontend: list column renders the label; both filters send `reactor`.

## Outside the code

The team adds a `Reactor` column to `Master_Reactor_Sampling_Tracker_v2.xlsx`.
Until they do, the upload behaves exactly as it does now.

## Left to the builder

Alias spellings, exact warning wording, how the Experiments tab fetches the slot,
and whether the filter parsing lives in the router or a small helper beside
`parse_reactor_cell`.
