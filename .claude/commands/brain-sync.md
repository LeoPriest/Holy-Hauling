Generate a brain-sync document for this session and deliver it to the Neural Brain intake folder. Also update CHANGELOG.md and CAPABILITIES.md to reflect this session's work.

Session description (if provided): $ARGUMENTS

## Steps

1. Run `python scripts/brain-sync.py` to generate the base document with auto-filled sections (git log, current state from CLAUDE.md, blockers). Pass `--session "$ARGUMENTS"` if a session description was provided, otherwise omit it.

2. Read the generated file from `docs/sync/`.

3. Fill in the judgment-based sections using your knowledge of this session:

   - **What was tried and failed**: anything that was attempted, discovered to be wrong, rolled back, or abandoned during this session. If nothing failed or was abandoned, write "none."
   - **Decisions made**: key design or implementation decisions made this session, with rationale. Focus on non-obvious choices.
   - **Open questions**: unresolved items that came up but weren't resolved.

4. Write the completed document back to `docs/sync/` (local record).

5. **Update CHANGELOG.md** — only if this session produced meaningful committed work (check the git log from step 1). If there are new commits since the last session:
   - Read `CHANGELOG.md`.
   - Prepend a new dated slice entry (use today's date) above the most recent entry, following the existing format: `## [YYYY-MM-DD] Slice N — <title>` with `### Added`, `### Changed`, `### Notes`, `### Verified` subsections as applicable.
   - Base the entry on the commits and decisions from this session. Be specific: list new fields, new endpoints, new UI components, behavior changes, and test counts.
   - If no commits were made this session (session-start sync or exploration only), skip this step and note it in the report.

6. **Update CAPABILITIES.md** — always run this step regardless of whether commits were made:
   - Read `CAPABILITIES.md`.
   - In **Currently Working**: add checkboxes for any new capabilities delivered this session (features, fields, endpoints, UI components). Do not duplicate existing entries.
   - In **Partially Working / Needs Live Verification**: add any items that were implemented but not yet live-verified; remove items that are now fully verified.
   - In **Broken / In Progress**: add any newly discovered broken items; remove items that have been fixed.
   - In **Planned / Not Yet Built**: remove items that were built this session; add any newly identified planned work.
   - Update the **Last Verified** section at the bottom: set the date to today, update the notes to reflect the current test count and what was completed.
   - Do not reformat or reorder existing entries — only add, remove, or edit specific lines.

7. Also write the completed brain-sync document to the Neural Brain intake path:
   `C:\Users\andre\OneDrive\Documents\Yarbel Holdings LLC\AI Lab\Knowledge Operating System\06_Projects\holy-hauling-app\intake\brain-sync.md`
   Overwrite any existing file at that path — the Brain's `/sync-project` skill will move it to `processed/` after consuming it.

8. Report all file paths touched (sync doc, CHANGELOG.md, CAPABILITIES.md, Neural Brain intake). Print the completed brain-sync document so the user can review it. Remind the user to run `/sync-project holy-hauling-app` in the Neural Brain repo to apply the updates.
