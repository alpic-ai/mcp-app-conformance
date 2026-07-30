# Contributing

npm workspaces; everything is TypeScript. Node >= 22.

```bash
npm install
npm run build          # bundles the view (dist/view/index.html) + server + runner
npm run start          # http://localhost:3000/mcp   (or: npm run dev for watch mode)
npm run typecheck      # root (view + server + shared) + runner
```

## Running the suite against a real host

```bash
npm run driver -- --host playground     # no login — quick smoke test of the whole pipeline
npm run driver -- --host chatgpt        # logged-in profiles (first run: log in by hand, it persists)
npm run driver -- --host claude
npm run driver -- --host mistral
npm run driver -- --host cursor         # Electron — launches it with a CDP port and attaches
npm run driver -- --host goose          # (both quit a running instance first: Electron is single-instance)
npm run report                          # refresh docs/index.html from the latest results
npm run how-it-works                    # + npm run architecture → docs/*.html
```

- A persistent Chrome profile per host lives in `runner/.profiles/<host>` (gitignored, holds real login state — never publish it); results in `runner/out/<host>/results-<ts>.json`; a session recording in `docs/recordings/<host>.webm` (`--no-video` to disable).
- **`headless` stays off by design** — headless Chromium drops cross-origin `MessagePort` transfers and breaks the MCP Apps init handshake.
- Desktop hosts (Cursor, Goose) are plain `BrowserHost` subclasses that override `open()` to attach to a running Electron app over CDP. They quit any running instance to claim the debug port, so save your work first.

## Layout

| Path | What |
|------|------|
| `shared/protocol.ts` | The typed contract — `CapabilityRequest`/`CapabilityResult`, `SuitePoll`, the channel. Imported by both sides. |
| `view/` | React runner (ext-apps `useApp`) + `harness/` (`assert` · `host-gateway` · `registry` engine · `channel`) + `tests.ts`. |
| `runner/` | The external driver: `Host`/`SuiteBridge`, the `Runner`, `hosts/` (abstract `BrowserHost` + one adapter per host), report generators, CLI. `src/index.ts` is the package entry. |
| `server/` | Reference MCP server (Streamable HTTP `/mcp` + stdio; deploys on Alpic via `alpic deploy`). |
| `catalogue.json` | Every requirement (clause, vantage, spec line, implemented flag) — drives the report and the in-view spec links. |
| `docs/` | Published to GitHub Pages: results matrix, architecture + how-it-works pages, recordings. |

## Publishing

`files` in `package.json` is an allowlist — only `dist/` + README + LICENSE ship. That is the sole thing keeping `runner/.profiles` (real host login cookies) and `docs/recordings/*.webm` out of the tarball, so **never add an `.npmignore`** (it would replace `.gitignore`) and re-check after touching `package.json`:

```bash
npm pack --dry-run | grep -Ei "profiles|runner/out|recordings|\.webm"   # must be empty
```

Expect ~46 files / ~190 kB. `prepack` rebuilds automatically, so a stale `dist/` can't be published.

## Further reading

| Doc | What it's for |
|-----|---------------|
| [How to run against your host](docs/how-to/run-against-your-host.md) | Connect the server to a host and run the suite |
| [Architecture](https://alpic-ai.github.io/mcp-app-conformance/architecture.html) | Host / Runner / TestSuite, the capability protocol, the pull model |
| [How it works](https://alpic-ai.github.io/mcp-app-conformance/how-it-works.html) | The pipeline, test buckets, where the driver overfits each host |
| [Host conformance catalogue](docs/reference/catalogue.md) | Every host requirement — clause, vantage, status |
| [Conformance model](docs/explanation/conformance-model.md) | The WPT analogy, the vantage model, the trust model, what's deferred |
| [Strategy & open questions](docs/strategy-and-open-questions.md) | Draft for the working group |
