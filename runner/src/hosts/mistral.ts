import type { Page } from "playwright";
import { BrowserHost } from "./browser.js";
import { CLICK_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS, sleep } from "./util.js";

// Mistral's Le Chat renders MCP apps in a sandboxed
// `*.web-sandbox.mistralusercontent.com/mcp-apps` iframe, and its composer is a
// ProseMirror contenteditable (single Enter sends) — structurally like Claude.
export class MistralBrowserHost extends BrowserHost {
  readonly name = "mistral";
  readonly url = "https://chat.mistral.ai/chat";
  readonly widgetSelector = 'iframe[src*="mistralusercontent"]';

  // Le Chat's "Opening an external link" dialog accepts with a "Confirm" button.
  protected readonly openLinkConsentLabel = "Confirm";

  // While Le Chat is generating, its Send arrow becomes a "Stop generation"
  // button; click it so the prior test's turn doesn't occupy the composer.
  protected async stopGeneration(page: Page): Promise<void> {
    const btn = page.locator('button[aria-label="Stop generation"]');
    for (let i = 0; i < 6; i++) {
      if (!(await btn.count())) break;
      await btn
        .first()
        .click({ timeout: CLICK_TIMEOUT_MS })
        .catch(() => {});
      await sleep(300);
    }
  }

  // Best-effort cookie/consent dismissal (a logged-in profile usually has none).
  protected async dismissModal(page: Page): Promise<void> {
    await page.evaluate(() => {
      const g = globalThis as any;
      const b = [...g.document.querySelectorAll("button")].find((x: any) =>
        /^(accept all|tout accepter|j'accepte|accepter|accept)$/i.test(
          (x.textContent || "").trim(),
        ),
      );
      if (b) b.click();
    });
    await sleep(500);
  }

  // ProseMirror composer, single Enter sends; sending navigates to /(work|chat)/<id>.
  // Popovers can swallow input, so fill + Enter are each retried and verified.
  protected async sendPrompt(page: Page, appName: string): Promise<void> {
    await this.dismissModal(page);
    const prompt = `run ${appName}`;
    const composer = page.locator('div[contenteditable="true"]').first();
    await composer.click({ timeout: PAGE_LOAD_TIMEOUT_MS });
    for (let i = 0; i < 3; i++) {
      await composer.fill(prompt);
      await sleep(1_000);
      if (((await composer.innerText()) || "").includes(prompt)) break;
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Enter");
      await sleep(3_000);
      if (/\/(work|chat)\/[0-9a-f-]{6,}/i.test(page.url())) return; // sent
      try {
        if (!((await composer.innerText()) || "").includes(prompt)) return;
      } catch {
        return; // composer re-rendered away: the message left
      }
    }
    throw new Error("the Mistral composer never sent the prompt");
  }

  // No known same-origin conversation API, so scrape the visible transcript.
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
      8_000,
    );
  }

  // Like Claude, Le Chat drafts a ui/message into the composer instead of sending
  // it — but with no "Replace current text?" step: the text is just placed and
  // needs a Send click.
  protected async commitMessage(page: Page): Promise<void> {
    // The host writes the ui/message into the composer asynchronously, so wait for
    // the draft to actually land (composer non-empty) before sending — a fixed
    // delay races it and sends an empty message, so the marker never lands in the
    // conversation and the check fails.
    const composer = page.locator('div[contenteditable="true"]').first();
    for (let i = 0; i < 20; i++) {
      if (((await composer.innerText().catch(() => "")) || "").trim()) break;
      await sleep(300);
    }
    await sleep(300); // let the draft settle
    const btn = page.locator('button[aria-label="Send"]');
    if (await btn.count()) {
      await btn.first().click({ timeout: CLICK_TIMEOUT_MS });
      return;
    }
    try {
      await composer.press("Enter");
    } catch {
      /* give up */
    }
  }
}
