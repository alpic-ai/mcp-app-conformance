# mcp-apps-conformance

Conformance-test any **MCP Apps** host against the spec ([SEP-1865 · `2026-01-26`](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)), modeled on [web-platform-tests](https://web-platform-tests.org).

> The host is the browser. The `ui://` page is the WPT test. The bridge is the harness.

A single `ui://` page — the **TestSuite** — renders inside your host's sandboxed iframe, drives the `postMessage`/JSON-RPC bridge, and asserts your behaviour against the spec. Run it by hand, or drive it from CI.

## 1 · Serve the suite

No clone, no build — the suite is bundled in:

```bash
npx mcp-apps-conformance            # http://localhost:3000/mcp
npx mcp-apps-conformance --stdio    # or stdio, for a desktop host's config
```

Connect that as an MCP server in your host and prompt the agent:

> Run the MCP Apps conformance suite using the `run_conformance` tool.

The results render in the iframe. When a test needs a host action, an action card appears and **It worked / It didn't / Skip** records the verdict — so it works with no automation at all.

## 2 · Automate it against your host

Describe your UI in three hooks; the generic `Runner` does the rest and hands back `SubtestResult[]`.

```bash
npm i -D mcp-apps-conformance playwright
npx playwright install chromium
```

```ts
import { BrowserHost, Runner } from "mcp-apps-conformance";
import type { Page } from "playwright";

class MyHost extends BrowserHost {
  readonly name = "my-host";
  readonly url = "https://my-host.example/chat";
  readonly widgetSelector = 'iframe[src*="my-sandbox-origin"]';

  // Get the agent to render the conformance app.
  protected async sendPrompt(page: Page, appName: string) {
    await page.fill("#composer", `run ${appName}`);
    await page.keyboard.press("Enter");
  }

  // Cookie banner / login wall, if any.
  protected async dismissModal(_page: Page) {}

  // Did this turn actually reach the conversation?
  protected async verifyConversation(page: Page, marker: string, timeoutMs: number) {
    return this.pollMarker(page, (m) => (document.body.innerText.includes(m) ? "found" : "no"),
                           marker, timeoutMs, 3_000);
  }
}

const { results } = await new Runner(new MyHost(), {
  appName: "MCP Apps Conformance",
  profileDir: ".profile/my-host",
}).run();

if (results.some((r) => r.status === "FAIL")) process.exit(1);   // gate CI on the spec
```

Two things worth knowing:

- **Every capability method is optional.** Only `setup`/`teardown` are required, so an adapter is useful long before it's complete — a capability you don't implement resolves to `unsupported` and those tests skip instead of failing.
- **`headless` stays off by design.** Headless Chromium drops cross-origin `MessagePort` transfers, which breaks the MCP Apps init handshake.

Electron desktop apps work too: override `open()` to attach over CDP instead of launching Chrome — that's the whole difference (see the bundled Cursor and Goose adapters).

`mcp-apps-conformance/protocol` is a dependency-free subpath with just the types and the channel constant, for the in-iframe side.

## Results & docs

Live cross-host matrix, the architecture, and the requirement catalogue:
**[alpic-ai.github.io/mcp-app-conformance](https://alpic-ai.github.io/mcp-app-conformance/)** · [architecture](https://alpic-ai.github.io/mcp-app-conformance/architecture.html) · [how it works](https://alpic-ai.github.io/mcp-app-conformance/how-it-works.html)

Working on the harness itself? See [CONTRIBUTING.md](CONTRIBUTING.md). MIT.
