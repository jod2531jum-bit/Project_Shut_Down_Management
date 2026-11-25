# Shutdown Form: what the importer expects

Upload the workbook exactly as you prepare it. The importer reads the **cached values** Excel saved (it never recalculates formulas), so open and save the file in Excel before uploading.

## Layout it looks for

- A sheet named `OCT2026`, or else the first visible sheet, that has the headers **Section** (column A), **Location** (B), **Description** (C), **Date & Time START / FINISH** (D, E) and **Duration (Hrs.)** (H). Their row can move; the labels are what count.
- The hourly Gantt grid to the right is ignored (it is only conditional formatting).
- Hidden sheets are ignored.

## Conventions that carry meaning

| In the workbook | What the app does |
|---|---|
| A row with `**` in column A | Starts a **section** (e.g. "EVAPORATOR-2"); its dates are the section window |
| Rows below, until the next `**` | Jobs of that section; column B is the **unit** |
| Description starting `Stop sequence` / `Stop …` | Starts the **Shutdown** phase |
| `Maintenance time: …` | Starts the **Maintenance** phase |
| `Critical: …` | A **Critical task** (★); the rows under it are its steps |
| `Start sequence` | Starts the **Start-up** phase |
| Indented / bold description | Bold or unindented marker rows are phase headers; indented rows are steps under them |
| Column A team codes (`PD`, `MMEN+EMEN`, `PD, MMUT`) | Shown as responsible teams |
| Trailing `*` in column A (`MMEN*`, `PD***`) | Marks the job critical |
| Only a start **or** a finish | A milestone (diamond) |
| Cell comments on columns A to H | Shown as the job's note |
| Formulas like `=D15` / `=E22` pointing at other rows | Used as dependencies (parent roll-ups are ignored; cross-section links appear as "waits on") |

The shutdown **window** (and "Day X of N") is taken from the first section whose name contains "Production Shutdown"; you can change it on the import review screen.

## What gets flagged on the review screen

Nothing is hidden or silently fixed. Each item lists the Excel row.

- **Error:** `#REF!` dates; a finish before its start; dates more than 21 days outside the window (e.g. an old plan left in the file). These jobs are imported as *unscheduled* and shown under "Needs attention".
- **Warning:** text in a date cell ("Continue"); an implausible duration; a job with no dates.
- **Info:** milestone from a single date; a label row whose dates were taken from its steps.

To fix an item, correct it in the Shutdown Form and upload again. Re-uploads match jobs by section, phase and description, so progress already entered is kept. If you rename a job, its progress is not carried over (the review screen shows the count of unmatched progress records).

## Tips

- Don't use "Actual" columns F/G for real actuals: the app tracks actuals itself and ignores those columns.
- Keep descriptions unique within a section and phase where you can; identical rows are matched in order.
- Avoid very old test rows (like a previous year's TG-2 plan) in the live file.
