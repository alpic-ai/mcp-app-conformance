import type { Page } from "playwright";
import { BrowserHost } from "./browser.js";
import { PAGE_LOAD_TIMEOUT_MS, sleep } from "./util.js";

// The mcp-use "Manufact" inspector auto-connects to the conformance server via
// its ?server= URL param (no login) and renders MCP apps in a
// sandbox-inspector.manufact.com iframe. Its chat has a real LLM that calls tools.
export class ManufactBrowserHost extends BrowserHost {
  readonly name = "manufact";
  readonly url =
    "https://inspector.manufact.com/inspector?server=https%3A%2F%2Fmcp-apps-conformance.alpic.live%2F&tab=chat";
  readonly widgetSelector = 'iframe[src*="sandbox-inspector.manufact.com"]';

  // No login / consent — the inspector auto-connects from the URL param.
  protected async dismissModal(_page: Page): Promise<void> {}

  // The chat calls tools via its LLM, so a plain prompt naming run_conformance
  // renders the app (appName is irrelevant here). Wait for the auto-connect first.
  protected async sendPrompt(page: Page, _appName: string): Promise<void> {
    await page
      .getByText("mcp-apps-conformance-server")
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {});
    const input = page.locator('textarea[data-testid="chat-input"]');
    await input.click({ timeout: PAGE_LOAD_TIMEOUT_MS });
    await input.fill(
      "Run the MCP Apps conformance test suite using the run_conformance tool.",
    );
    await sleep(500);
    await page
      .locator('button[data-testid="chat-send-button"]')
      .first()
      .click();
  }

  // The chat transcript renders in the top-page DOM, so scan it for the marker.
  protected async verifyConversation(
    page: Page,
    marker: string,
    timeoutMs: number,
  ): Promise<boolean> {
    return this.pollMarker(
      page,
      (m: string) =>
        (globalThis as any).document.body.innerText.includes(m)
          ? "found"
          : "not-found",
      marker,
      timeoutMs,
      6_000,
    );
  }
}
