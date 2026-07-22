import type { Page } from "playwright";
import { BrowserHost } from "./browser";
import { PAGE_LOAD_TIMEOUT_MS, sleep } from "./util";

export class ChatGPTBrowserHost extends BrowserHost {
  readonly name = "chatgpt";
  readonly url = "https://chatgpt.com/";
  readonly widgetSelector = 'iframe[src*="oaiusercontent"]';

  // Type "run @{app}": the first Enter picks the app from the mention picker,
  // the second sends.
  protected async sendPrompt(page: Page, appName: string): Promise<void> {
    await page.fill("#prompt-textarea", `run @${appName}`, { timeout: PAGE_LOAD_TIMEOUT_MS });
    await sleep(3_000); // mention picker
    await page.keyboard.press("Enter");
    await sleep(1_000);
    await page.keyboard.press("Enter");
  }

  protected async dismissModal(page: Page): Promise<void> {
    await page.evaluate(() => {
      const g = globalThis as any;
      const b = [...g.document.querySelectorAll("button")].find(
        (x: any) => x.textContent.trim() === "Got it",
      );
      if (b) b.click();
    });
  }

  // Poll ChatGPT's own conversation API for `marker`. The snapshot endpoint only
  // reflects a turn once it completes, which can lag dispatch by 30-45s.
  protected async verifyConversation(
    page: Page,
    marker: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const fn = async (m: string): Promise<string> => {
      const g = globalThis as any;
      const id = (g.location.pathname.match(/\/c\/([a-z0-9-]+)/i) || [])[1];
      if (!id) return "no-conversation-id";
      const token = (await (await g.fetch("/api/auth/session")).json()).accessToken;
      const account = (g.document.cookie.match(/_account=([^;]+)/) || [])[1] || "";
      const r = await g.fetch("/backend-api/conversation/" + id, {
        headers: { Authorization: "Bearer " + token, "ChatGPT-Account-ID": account },
      });
      if (!r.ok) return "http-" + r.status;
      const body = JSON.stringify(await r.json());
      return body.includes(m) ? "found" : "not-found/" + body.length + "B";
    };
    return this.pollMarker(page, fn, marker, timeoutMs, 8_000);
  }
}
