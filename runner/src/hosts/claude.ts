import type { Page } from "playwright";
import { BrowserHost } from "./browser";
import { CLICK_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS, sleep } from "./util";

export class ClaudeBrowserHost extends BrowserHost {
  readonly name = "claude";
  readonly url = "https://claude.ai/new";
  readonly widgetSelector = 'iframe[src*="claudemcpcontent"]';

  // Accept the cookie banner: its overlay swallows clicks near the composer.
  protected async dismissModal(page: Page): Promise<void> {
    await page.evaluate(() => {
      const g = globalThis as any;
      const b = [...g.document.querySelectorAll("button")].find(
        (x: any) => x.textContent.trim() === "Accept All Cookies",
      );
      if (b) b.click();
    });
    await sleep(1_000);
  }

  // Claude's composer is a ProseMirror contenteditable (no mention picker; a
  // single Enter sends). Typing/Enter get swallowed by the cookie banner /
  // onboarding popovers, so verify each and retry.
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
      if (page.url().includes("/chat/")) return; // a sent message navigates to /chat/<id>
      try {
        if (!((await composer.innerText()) || "").includes(prompt)) return;
      } catch {
        return; // composer re-rendered away: the message left
      }
    }
    throw new Error("the Claude composer never sent the prompt");
  }

  // No known same-origin conversation API on claude.ai, so scrape the visible
  // transcript text for the marker.
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
      8_000,
    );
  }

  // Claude drafts a ui/message into the composer as a *proposal* (with a
  // "Replace current text?" link) instead of sending it. Accept the proposal,
  // then click Send.
  protected async commitMessage(page: Page): Promise<void> {
    await this.clickTopPageButton("Replace current text?", 6);
    await sleep(500);
    try {
      const btn = page.locator('button[aria-label="Send message"]');
      if (await btn.count()) {
        await btn.first().click({ timeout: CLICK_TIMEOUT_MS });
        return;
      }
    } catch {
      /* fall through to the Enter fallback */
    }
    try {
      await page.locator('div[contenteditable="true"]').first().press("Enter");
    } catch {
      /* give up */
    }
  }
}
