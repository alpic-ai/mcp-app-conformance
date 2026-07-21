# Conformance driver (local — ChatGPT & Claude)

Runs the conformance suite on a real host and writes what the runner reported to
`out/<host>/results.json`. No LLM, no scraping of the results table: it reads the
app's `conformance:state` broadcast (see `view/automation.ts`) and drives the
manual tests with real cross-origin clicks + host permission dialogs.

Local Chrome only for now — a persistent profile **per host** you log into once
by hand (`notte/.profiles/<host>`, gitignored).

**Hybrid execution:** the automatic (in-view) tests run all at once (`run-auto`);
each manual test then runs **individually** (`run-test <id>`) with a reset in
between — closing stray tabs and dismissing host dialogs — so one test can't
poison the next (e.g. open-link's consent backdrop swallowing the message test).
The human "Run all" button in the app still runs everything in one pass.

## Prerequisites

- [`uv`](https://docs.astral.sh/uv/) (resolves the script's inline deps; no separate install)
- Google Chrome installed (`channel="chrome"` — no browser download)
- The deployed conformance server **connected as an app** in your ChatGPT
  account (developer mode), named `Conformance` (override with `--app-name`)

## Run

```bash
uv run notte/conformance.py --host chatgpt --app-name Conformance
uv run notte/conformance.py --host claude  --app-name Conformance
```

- **First run (per host):** a Chrome window opens on a fresh profile
  (`notte/.profiles/<host>`). Log into the host by hand, make sure the app is
  connected in that account, then re-run — the session persists.
- A full run takes a few minutes (manual tests wait on the model; the follow-up
  and model-context checks poll for the marker up to ~2 min each).
- **`headless=False` is mandatory** — headless Chromium drops cross-origin
  MessagePort transfers, which breaks the ext-apps init handshake.

## Report

Build a matrix of the latest run per host — tests down the left grouped by
RFC-2119 clause, one column per host — self-contained HTML written to
`docs/index.html` (served by GitHub Pages):

```bash
python3 notte/report.py        # writes docs/index.html
open docs/index.html           # local preview
```

**Publish** (GitHub Pages, once): Settings → Pages → Deploy from a branch →
`main` / `/docs`. Then each `report.py` run + `git commit docs/index.html`
+ push updates <https://alpic-ai.github.io/mcp-app-conformance/>.

- Driven by **`catalogue.json`** (every requirement + clause + vantage + spec
  line + `implemented` flag). Edit that file as tests land / requirements change.
- **Grouped by clause** (MUST → MUST NOT → REQUIRED → SHOULD → SHOULD NOT → MAY).
  A FAIL under SHOULD/MAY means the optional behavior isn't supported — not a
  spec violation; the clause section conveys that (PASS/FAIL only, no INFO).
- Each test links to its **exact spec line** (`apps.mdx?plain=1#L…`).
- Cells color-coded PASS / FAIL; hover for the message + driver action.
- A **"Not yet implemented"** section lists catalogue requirements with no
  runner test yet (clause + vantage + spec link).

### Host differences

- **ChatGPT**: composer is `#prompt-textarea`, `run @app` uses the mention
  picker, side-effects verified via `/backend-api/conversation/<id>`.
- **Claude**: composer is a ProseMirror `contenteditable` (`run app`, single
  Enter); dismisses the cookie banner first. It has **no known conversation
  API**, so `messages`/`model-context`/`app-tool-hidden` are verified by
  scraping the transcript text — weaker than ChatGPT's API check.

## What it does per manual test

| Test | How the driver settles it |
| --- | --- |
| `links/open-external` | real-click trigger → accept the "Open link" dialog → yes |
| `download-file/confirm` | real-click trigger → accept the "Download" dialog → yes |
| `sampling/create-message` | real-click trigger → accept an approval dialog if shown → yes |
| `messages/add-to-conversation` | real-click trigger → verify the message via the conversation API |
| `model-context/provide-future-turns` | real-click trigger → verify the recalled code (`MCP-APP-7421`) |
| `visibility/app-tool-hidden` | real-click trigger → verify `conformance_probe` is **absent** |
| `app-tools/call` | real-click trigger → agent calls the tool → the test auto-passes |
| `messages/consent` | real-click trigger → yes (the runner reports the INFO signal) |
| `context/context-changed` | **skipped** (theme toggle isn't driveable from here yet) |

Anything the driver can't verify from outside is skipped rather than guessed.

## Not yet wired (see the plan)

`--mode notte` (cloud browser over CDP for headless CI), baselines, screenshots,
and a CI workflow. The `--mode` flag already carries the seam.
