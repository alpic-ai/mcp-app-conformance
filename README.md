# MCP Apps Conformance

![MCP Apps Conformance Screenshot](screenshot.png)

A **host-conformance test runner for the MCP Apps spec** ([SEP-1865 · `2026-01-26`](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), extension id `io.modelcontextprotocol/ui`), modeled on [web-platform-tests](https://web-platform-tests.org).

It ships a single `ui://` test page (the **TestSuite**) that renders **inside the host's sandboxed iframe**, drives the `postMessage`/JSON-RPC bridge, asserts the host's behaviour against the spec, and shows `PASS`/`FAIL` right in the iframe. An optional external **Runner** automates the human steps against a real host and collects results.

> **The host is the browser. The `ui://` page is the WPT test. The bridge is the harness.**

## Architecture: Host / Runner / TestSuite

The harness is split into three objects so **any host can run it** — a web chat client today, a desktop app like VSCode or Goose tomorrow. All platform-specific code lives behind one `Host` interface.

- **TestSuite** (`view/`, in the iframe) — owns the test definitions and the MCP-app communication (the ext-apps `App`). A test emits a typed `CapabilityRequest`, awaits the result, and asserts.
- **Runner** (`runner/`, external) — lists tests, then pumps each request the suite parks to the Host and feeds the result back. A generic dispatcher with **no per-test logic**.
- **Host** (`runner/src/hosts/`) — the only platform-specific piece. Opens the app, prompts the agent so the suite renders, and exposes one method per capability. `BrowserHost` (Playwright) is the only implementation today; `VSCodeHost` / `GooseHost` are drop-in peers later.

The suite installs one control seam at `window.__mcpConformance` (`listTests` / `start` / `poll` / `resolve`); the Runner reaches it via `frame.evaluate`. The suite **pulls** (a test awaits a request) and the Runner **polls** — the iframe never has to push out (nested cross-origin `postMessage` is unreliable).

Full write-up → **[docs/architecture.html](https://alpic-ai.github.io/mcp-app-conformance/architecture.html)** · methodology → **[how-it-works](https://alpic-ai.github.io/mcp-app-conformance/how-it-works.html)** · live matrix → **[Results](https://alpic-ai.github.io/mcp-app-conformance/)**.

## Run it against a host

**By hand (any host).** Connect this MCP server and prompt the host to render the runner, then click **Run**:

- **Server URL:** `https://mcp-apps-conformance.alpic.live/mcp`
- **Prompt:** *“Run the MCP Apps conformance test suite against this host using the `run_conformance` tool, then I'll click Run.”*

When a test needs a host action, an action card appears — the trigger button fires the gesture-gated calls, and **It worked / It didn't / Skip** records the verdict. Full walkthrough → **[How to run against your host](docs/how-to/run-against-your-host.md)**.

**Automated (the Runner).** Drive a real host with Playwright and write a results file:

```bash
npm run driver -- --host playground     # no login — quick smoke test of the whole pipeline
npm run driver -- --host chatgpt        # logged-in profiles (first run: log in by hand, the profile persists)
npm run driver -- --host claude
npm run report                          # refresh docs/index.html from the latest results
```

- A persistent Chrome profile per host lives in `runner/.profiles/<host>` (gitignored); results in `runner/out/<host>/results-<ts>.json`; a session recording in `docs/recordings/<host>.webm` (`--no-video` to disable).
- **`headless` stays off by design** — headless Chromium drops cross-origin `MessagePort` transfers and breaks the ext-apps init handshake.

**Status:** 33 of 56 host requirements implemented — `in-view` automatic checks plus interactive `· manual` ones (open-link, download, sampling, ui/message, model-context, app-tool visibility, theme change) and operator checks (iframe sandboxing, CSP audit log).

## Documentation

| Doc | What it's for |
|-----|---------------|
| [How to run against your host](docs/how-to/run-against-your-host.md) | Connect the server to a host and run the suite (start here) |
| [Architecture](https://alpic-ai.github.io/mcp-app-conformance/architecture.html) | Host / Runner / TestSuite, the capability protocol, the pull model, pluggable hosts |
| [How it works](https://alpic-ai.github.io/mcp-app-conformance/how-it-works.html) | The pipeline, test buckets, and where the browser driver overfits each host |
| [Host conformance catalogue](docs/reference/catalogue.md) | Every host requirement — its clause, vantage, and status |
| [How the conformance model works](docs/explanation/conformance-model.md) | The WPT analogy, the vantage model, the trust model, and what's deferred |
| [Strategy & open questions](docs/strategy-and-open-questions.md) | Draft for the working group — the trust-test and results-storage problems |

## Develop

npm workspaces; everything is TypeScript.

```bash
npm install
npm run build          # bundles the view (dist/view/index.html) + builds the server
npm run start          # http://localhost:3000/mcp   (or: npm run dev for watch mode)
npm run typecheck      # root (view + server + shared) + runner
npm run driver -- --host playground
npm run report         # + npm run how-it-works / npm run architecture → docs/*.html
```

Repo layout:

| Path | What |
|------|------|
| `shared/protocol.ts` | The typed contract — `CapabilityRequest`/`CapabilityResult`, `SuitePoll`, the channel. Imported by both sides. |
| `view/` | React runner (ext-apps `useApp`) + `harness/` (`assert` · `host-gateway` · `registry` engine · `channel`) + `tests.ts`. |
| `runner/` | The external driver: `Host`/`SuiteBridge`, the `Runner`, `hosts/` (abstract `BrowserHost` + ChatGPT/Claude/Playground), report generators, CLI. |
| `server/` | Reference MCP server (Streamable HTTP `/mcp`, Node-only; deploys on Alpic via `alpic deploy`). |
| `catalogue.json` | Every requirement (clause, vantage, spec line, implemented flag) — drives the report and the in-view spec links. |
| `docs/` | Published to GitHub Pages: the results matrix, the architecture + how-it-works pages, and session recordings. |

## Scope

The **runner + driver + report** work end to end; cross-host aggregation lives in the Pages matrix. Server-side judging and a persistent results store remain future work (see [what's deferred](docs/explanation/conformance-model.md#whats-deferred-beyond-the-poc)).
