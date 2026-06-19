# Design Assembly

After writing the Stitch UI prompt in `ui_design_prompt`, the harness **waits
for the human** to take the prompt to Google Stitch, generate the screens, and
return with a **Stitch project ID**. This is enforced through the
`waiting_for_design_stitch` human gate.

## Purpose

The NLA-001 run revealed that agents skipped fetching actual Stitch-generated
screens. The harness had a step for writing the prompt but no step for
retrieving the output or waiting for the human to generate it in Stitch first.
This led to design assets being missing or placed in `/tmp` instead of the run
directory.

## Flow

1. `ui_design_prompt` → agent writes the Stitch prompt.
2. `waiting_for_design_stitch` → human takes the prompt to Google Stitch,
   generates screens, returns with a **Stitch project ID** in the gate
   approval_note.
3. `design_assembly` → agent records the design assets from the Stitch project
   to `runs/<DELIVERY_ID>/design-assets/`.
4. `system_rules` → proceeds with system rule derivation.

## State

`design_assembly` — owned by Product Manager. Preceded by
`waiting_for_design_stitch` (human gate).

## Process

1. Transition from `ui_design_prompt` to `waiting_for_design_stitch`.
2. Present the Stitch prompt to the human and ask them to generate screens.
3. Wait for the human to return with the Stitch project ID.
4. Once approved, transition to `design_assembly`.
5. Save each generated screen as a standalone HTML file under:
   ```
   runs/<DELIVERY_ID>/design-assets/<NN>-<screen-name>.html
   ```
6. Name files with a two-digit sequence prefix for ordering:
   - `00-start-loading.html`
   - `01-play-mode.html`
   - `02-play-mode-animated.html`
   - `03-celebration-guide.html`
   - `04-parent-dashboard.html`
   - `05-celebration-3d.html`
7. Record the generated files in `artifacts.design_assets.evidence[]`.
8. Update `artifacts.design_assets`:
   - `status`: `ready_for_review`
   - `path`: `runs/<DELIVERY_ID>/design-assets/`
   - `evidence[]`: List of generated file names
9. Transition to `system_rules`.

## Write Scope

All design assets go exclusively to `runs/<DELIVERY_ID>/design-assets/`.
Never write design files to `/tmp`, the harness root, or any other location.

## Evidence

The `artifacts.design_assets` section in workflow-state.json records:
- `status`: `not_started` | `in_progress` | `ready_for_review` | `approved`
- `path`: Path to the design-assets directory
- `evidence[]`: List of generated files with descriptions
