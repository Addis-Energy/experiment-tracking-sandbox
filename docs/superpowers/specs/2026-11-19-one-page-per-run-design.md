# One page per run, and a clearer Experiments list: design

**Date:** 2026-11-19
**Branch:** `feat/segment-run-clarity`
**Decided by:** Mat, 2026-11-19 (page model: one page per run; default view: whole run with the clicked segment marked)
**Builds on:** #154 navigation epic (#155 to #165), #163 (one samples table), #164 (sample flags)

## Problem

After the #154 sweep every HPHT and Core Flood experiment still has two pages, and users cannot tell which one they should be on.

Observed on the dev app, 2026-11-19:

| | Run page `/hpht/HPHT_297` | Segment page `/experiments/HPHT_297-2` |
|---|---|---|
| Opens on | Samples | Conditions tab (Results is a second click) |
| Samples table | 14 columns, incl. Cum. H₂ g/t, g/t/day, Liq mL | 10 columns, none of those three |
| H₂ over time | 3 charts, titled "Run to date" | none |
| ICP over time | collapsed | collapsed |
| Notes, XRD, Entry Logs, full Conditions | not on the page | tabs |
| Start date, sample, background flag | not on the page | header |

The destination also depends on what was clicked, not on what the experiment is:

- Experiments list: the row opens the segment page; the Reactor cell of the same row opens the run page.
- Reactor modal: two buttons, "Open segment X" and "Open run page".
- HPHT / Core Floods lists: the run page.
- A run with one segment (for example `HPHT_304`) still has both pages, for what the user sees as one experiment.

On the Experiments list the Description column is capped at 12rem and cut after about 30 characters, while the ID column spends its width on a "▸ 3 replicates: a, b, c" button next to a separate, non-interactive "group" badge.

## Design

### 1. One page per HPHT / Core Flood run

The run page becomes the only page for an HPHT or Core Flood experiment. `/experiments/{id}` stays the page for every other type (Serum, Autoclave, Other).

**Layout, top to bottom:**

1. Breadcrumb (`HPHT › HPHT_297`), run ID, run description, reactor, Ongoing badge, Export, + Add sample. Unchanged.
2. **Segment picker**, only when the run has more than one segment: `Whole run · HPHT_297 · HPHT_297-2`, plus an "Only this segment's samples" toggle once a segment is picked. A single-segment run shows no picker and never uses the word "segment" in its header.
3. **Record header** for the selected segment: ID with rename, status, description editor, start date, sample, reactor, Mark as background, Delete. This is the detail page's header, extracted and reused.
4. **Tabs:** Results (default), Conditions, Notes, XRD, Entry Logs.
   - **Results** is run-level: conditions summary (HPHT), Samples table with ICP / MOD / DETAILS flags, **H₂ over time**, **ICP over time** (open by default), Side samples, Segments (multi-segment runs only), Data checks, Run totals (Core Flood).
   - **Conditions, Notes, XRD, Entry Logs** show the selected segment, using the detail page's existing tab components unchanged.

**Which segment is selected.** From `?segment=`. With no `segment` (the run was opened from a run list or the dashboard) it is the first ONGOING non-variant segment, else the latest-dated segment, and no rows are marked.

**Arriving from a segment ID** (`?segment=HPHT_297-2`): the whole run's samples and charts are shown, that segment's rows are marked in the Samples table, and the record header and the four record tabs show that segment. `&only=1` narrows the Samples table to that segment's rows. Charts always show the whole run, because cumulative values are run quantities.

**URL state:** `/hpht/{base}?segment={experiment_id}&only=1&tab=results|conditions|notes|xrd|logs`. The `tab` values are the detail page's existing `?tab=` values, so existing links carry over.

**Old segment URLs.** `/experiments/{id}` for an experiment whose type has a run page, and whose run loads and contains it, redirects (replace) to the run page with `?segment={id}` and the same `tab`. If the run cannot be loaded the detail page renders as it does today, so no experiment becomes unreachable.

**Links.** One helper, `experimentHomePath(type, id, baseId, tab?)`, spells the destination. Callers that know the type use it (Experiments list row, reactor modal); callers that do not (activity feed, Notes review, sample page, `SegmentLink`) keep linking to `/experiments/{id}` and rely on the redirect. Inside a run page, segment IDs link to `?segment=` on the same page. The Experiments list Reactor cell becomes plain text and the reactor modal has one "Open {id}" button, so no row or card offers two destinations.

**Core Flood gets the H₂ charts.** `HphtCharts` moves to `components/runs/H2Charts.tsx`; `v_core_flood_samples` already carries cumulative day, cumulative H₂ g/t and g/t/day. The Fe²⁺ yield chart is drawn only when the samples carry that value (HPHT).

### 2. Other experiment types

`/experiments/{id}` opens on **Results** (tab order: Results, Conditions, Notes, XRD, Entry Logs) and its "ICP over time" section is open by default. No H₂ chart is added there: a serum vial's time series lives on its group page.

### 3. Experiments list

- **Description** wraps to two lines in a column of 20rem to 36rem, with the full text as the tooltip.
- The "▸ N replicates: a, b, c" button is removed. The **group flag** becomes the control: a button reading `group · 3` with `aria-expanded`, whose tooltip lists the letters and which shows the replicate rows in place. A letterless vial set, which has nothing to expand, shows a plain `group · 4 vials` badge.
- Clicking the row or the ID of a group row still opens the group page.

## Out of scope

- No API, schema, view or calculation change. No new package.
- The replicate group page and the serum detail Results table are unchanged.
- The "Group replicates" checkbox stays.
- Playwright e2e specs (#166 tracks their refresh).

## Acceptance criteria

1. `/experiments/HPHT_297-2` lands on `/hpht/HPHT_297?segment=HPHT_297-2`; `?tab=notes` is preserved.
2. `/hpht/HPHT_304` (one segment) shows no segment picker and no Segments section; rename, status, description, start date, sample, background and delete are all on the page.
3. `/hpht/HPHT_297?segment=HPHT_297-2` shows all of the run's samples with the `HPHT_297-2` rows marked; the toggle narrows to those rows and back.
4. Conditions, Notes, XRD and Entry Logs on a run page show the selected segment and switch when another segment is picked.
5. Both run pages show H₂ over time and an open ICP over time section when the run has the data.
6. From the Experiments list, an HPHT or Core Flood row has exactly one destination.
7. A serum experiment opens on Results.
8. The list's Description shows two lines; the group flag expands replicates; no "replicates:" button remains.
9. `cd frontend && npm test && npm run lint && npm run type-check` exit 0.
