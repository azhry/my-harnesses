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

## Two Paths

### Path A: Human provides a Stitch link (recommended)

The human may provide a Google Stitch project URL directly. Store
`GOOGLE_STITCH_API_KEY` in the harness or run-local secrets file, then use
`fetch-stitch-designs.js` to fetch the screens programmatically. Do not ask the
human to paste the raw key into chat once the secrets file is configured.

**Google Stitch uses JSON-RPC, not REST.** The script sends JSON-RPC POST
requests by default, with a configurable method name and parameters.

### Path B: Human provides project ID plus endpoint

Fallback path where the human returns with a Stitch project ID and the API
endpoint/project URL in the gate approval_note. Use `fetch-stitch-designs.js`
with both `--url` and `--project-id`, then probe available methods with
`--list-methods`.

## Flow

1. `ui_design_prompt` → agent writes the Stitch prompt.
2. `waiting_for_design_stitch` → human provides a Stitch link (Path A) or
   returns with a **Stitch project ID plus endpoint** in the gate approval_note
   (Path B). `GOOGLE_STITCH_API_KEY` is loaded from secrets.
3. `design_assembly` → agent runs `fetch-stitch-designs.js` to fetch and save
   design screens to `runs/<DELIVERY_ID>/design-assets/`.
4. `system_rules` → proceeds with system rule derivation.

## State

`design_assembly` — owned by Product Manager. Preceded by
`waiting_for_design_stitch` (human gate).

## Process

1. Transition from `ui_design_prompt` to `waiting_for_design_stitch`.
2. Present the Stitch prompt to the human and ask them to generate screens in
   Google Stitch, then provide the Stitch project URL or endpoint/project ID.
3. Wait for the human to provide the Stitch link (or endpoint/project ID in
   gate approval_note).
4. Once the gate is approved, transition to `design_assembly`.

### Fetching screens with fetch-stitch-designs.js

Put the key in one of the auto-loaded secrets files first:

```bash
GOOGLE_STITCH_API_KEY=replace_me
```

Supported locations are:

```text
runs/<DELIVERY_ID>/.agent-spec-ops.secrets.env
.agent-spec-ops.secrets.env
.env.agent-spec-ops
```

**Standard usage (human provided URL):**

```bash
node scripts/fetch-stitch-designs.js \
  runs/<DELIVERY_ID>/workflow-state.json \
  --url <stitch_project_url>
```

**With a project ID and endpoint:**

```bash
node scripts/fetch-stitch-designs.js \
  runs/<DELIVERY_ID>/workflow-state.json \
  --url <stitch_endpoint_or_project_url> \
  --project-id <id> --list-methods
```

The `--list-methods` flag probes common JSON-RPC method names and reports
which one works. Once you know the method name:

```bash
node scripts/fetch-stitch-designs.js \
  runs/<DELIVERY_ID>/workflow-state.json \
  --url <stitch_endpoint_or_project_url> \
  --project-id <id> --method <method_name>
```

**With custom JSON-RPC params:**

```bash
node scripts/fetch-stitch-designs.js \
  runs/<DELIVERY_ID>/workflow-state.json \
  --url https://stitch.google.com/api \
  --method exportScreens \
  --params '{"projectId":"abc123","format":"html"}'
```

**If the endpoint uses REST instead of JSON-RPC:**

```bash
node scripts/fetch-stitch-designs.js \
  runs/<DELIVERY_ID>/workflow-state.json \
  --url <url> --rest
```

**List screens without saving:**

```bash
node scripts/fetch-stitch-designs.js \
  runs/<DELIVERY_ID>/workflow-state.json \
  --url <url> --list-screens
```

### What the script does

- Sends a JSON-RPC POST request to the Stitch endpoint with the API key
- Parses the response — supports JSON arrays, `screens[]`, `pages[]`,
  `exports[]`, `results[]`, HTML content, and plain text
- Detects JSON-RPC errors (`{"error":{"code":-32601,"message":"Method not found"}}`)
  and reports them clearly — never claims success on errors
- Saves each screen as a standalone HTML file: `<NN>-<screen-name>.html`
- Updates `artifacts.design_assets` with status, path, evidence, and errors
- Exits with code 1 if no screens were fetched (agents must check exit codes)

5. Name files with a two-digit sequence prefix for ordering:
   - `00-start-loading.html`
   - `01-play-mode.html`
   - `02-play-mode-animated.html`
   - `03-celebration-guide.html`
   - `04-parent-dashboard.html`
   - `05-celebration-3d.html`
6. Verify the fetch succeeded by checking script exit code (0 = success) and
   monitoring output — do NOT claim designs exist if the script reported errors.
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
