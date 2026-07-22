import type { Page } from "playwright";
import { BrowserHost } from "./browser";
import { PAGE_LOAD_TIMEOUT_MS, sleep } from "./util";

// A self-contained playground host at /try with the conformance app
// pre-connected — no login. Frames are same-origin, but the generic app-frame
// machinery drives it fine.
export class AlpicPlaygroundBrowserHost extends BrowserHost {
  readonly name = "playground";
  readonly url = "https://mcp-apps-conformance.alpic.live/try";
  readonly widgetSelector = "iframe";

  protected async sendPrompt(page: Page, _appName: string): Promise<void> {
    await page.fill(
      'textarea[name="message"]',
      "Run the MCP Apps conformance suite using the run_conformance tool.",
      { timeout: PAGE_LOAD_TIMEOUT_MS },
    );
    await sleep(1_000);
    await page.keyboard.press("Enter");
  }

  protected async dismissModal(_page: Page): Promise<void> {
    // no cookie/consent banner on the playground
  }

  // No conversation API on the playground; scrape the page text (best-effort).
  protected async verifyConversation(
    page: Page,
    marker: string,
    timeoutMs: number,
  ): Promise<boolean> {
    return this.pollMarker(
      page,
      (m: string) =>
        (globalThis as any).document.body.innerText.includes(m) ? "found" : "not-found",
      marker,
      timeoutMs,
      6_000,
    );
  }
}
