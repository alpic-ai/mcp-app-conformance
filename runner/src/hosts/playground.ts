import type { Page } from "playwright";
import { BrowserHost } from "./browser";
import { PAGE_LOAD_TIMEOUT_MS, sleep } from "./util";

// A self-contained playground host at /try with the conformance app
// pre-connected — no login. Frames are same-origin, but the generic app-frame
// machinery drives it fine.
export class AlpicPlaygroundBrowserHost extends BrowserHost {
  readonly name = "playground";
  // `?e2e=1` opts the playground into its read-only conversation seam
  // (window.__alpicPlayground.getMessages) — see verifyConversation.
  readonly url = "https://mcp-apps-conformance.alpic.live/try?e2e=1";
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

  // Read the conversation from the playground's state seam
  // (window.__alpicPlayground.getMessages, gated behind `?e2e=1`) rather than
  // scraping the DOM — messages added via ui/message are kept out of the visible
  // transcript, so an innerText scrape misses them. Falls back to the page text
  // if the seam is absent (older deploy without the seam).
  protected async verifyConversation(
    page: Page,
    marker: string,
    timeoutMs: number,
  ): Promise<boolean> {
    return this.pollMarker(
      page,
      (m: string) => {
        const api = (globalThis as any).__alpicPlayground as
          | { getMessages: () => { role: string; text: string }[] }
          | undefined;
        if (api) {
          return api.getMessages().some((msg) => msg.text.includes(m)) ? "found" : "not-found";
        }
        return (globalThis as any).document.body.innerText.includes(m) ? "found" : "not-found";
      },
      marker,
      timeoutMs,
      6_000,
    );
  }
}
