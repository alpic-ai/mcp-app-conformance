import { spawn } from "node:child_process";
import { type Browser, chromium, type Page } from "playwright";
import type { CapabilityResult } from "../../../shared/protocol.js";
import type { SetupOptions } from "../host.js";
import { BrowserHost } from "./browser.js";
import { PAGE_LOAD_TIMEOUT_MS, sleep } from "./util.js";

const APP = "/Applications/Goose 2.app";
const PORT = 9222;
const ENDPOINT = `http://127.0.0.1:${PORT}`;

// Goose 2 is an Electron desktop app. `_electron.launch` can't attach (the 53KB
// launcher stub re-execs the real process), but Goose honours
// `--remote-debugging-port`, so we launch it with that flag and attach over CDP.
// The conformance server must be added as a Goose extension so run_conformance
// renders the app.
export class GooseBrowserHost extends BrowserHost {
	readonly name = "goose";
	readonly url = "goose-desktop"; // unused — open() attaches to the app, doesn't navigate
	// Broad on purpose: Goose's renderer has no iframes until the app renders, and
	// appFrame() finds the right frame by the channel. Tighten once the exact
	// MCP-app iframe src is known.
	readonly widgetSelector = "iframe";

	private browser?: Browser;

	// Launch Goose with the CDP port (single-instance, so quit any running copy
	// first) and attach — instead of the base's launch-Chrome-and-goto.
	protected async open(_opts: SetupOptions): Promise<void> {
		await this.quitGoose();
		await sleep(1_500);
		spawn("open", ["-a", APP, "--args", `--remote-debugging-port=${PORT}`], {
			stdio: "ignore",
			detached: true,
		}).unref();

		const deadline = Date.now() + 30_000;
		let up = false;
		while (Date.now() < deadline) {
			try {
				await (await fetch(`${ENDPOINT}/json/version`)).json();
				up = true;
				break;
			} catch {
				await sleep(1_000);
			}
		}
		if (!up) throw new Error(`Goose CDP endpoint never came up on ${ENDPOINT}`);

		this.browser = await chromium.connectOverCDP(ENDPOINT);
		const ctx = this.browser.contexts()[0];
		this.context = ctx;
		this.page =
			ctx.pages()[0] ?? (await ctx.waitForEvent("page", { timeout: 15_000 }));
		await this.page.waitForLoadState("domcontentloaded").catch(() => {});
	}

	async teardown(): Promise<void> {
		try {
			await this.browser?.close(); // disconnects CDP (connectOverCDP doesn't quit the app)
		} catch {
			/* already gone */
		}
		await this.quitGoose();
	}

	private async quitGoose(): Promise<void> {
		await new Promise<void>((resolve) => {
			const p = spawn("pkill", ["-f", "Goose 2.app"], { stdio: "ignore" });
			p.on("close", () => resolve());
			p.on("error", () => resolve());
		});
	}

	// Desktop caveat: Goose opens ui/open-link in the OS browser (shell.openExternal),
	// which is outside our CDP context — a real open is unobservable here. Try the
	// in-app tab first (in case a future Goose opens internally); if none appears,
	// report unsupported so the test SKIPs instead of a false FAIL.
	async checkLinkOpen(url: string): Promise<CapabilityResult> {
		const r = await super.checkLinkOpen(url);
		return r.ok ? r : { ok: false, unsupported: true };
	}

	// No login/consent modal in the desktop app.
	protected async dismissModal(_page: Page): Promise<void> {}

	// Goose's composer is `textarea[data-testid="chat-input"]`; Enter sends.
	protected async sendPrompt(page: Page, _appName: string): Promise<void> {
		const input = page.locator('textarea[data-testid="chat-input"]');
		await input.click({ timeout: PAGE_LOAD_TIMEOUT_MS });
		await input.fill(
			"Run the MCP Apps conformance test suite using the run_conformance tool.",
		);
		await sleep(500);
		await page.keyboard.press("Enter");
	}

	// The chat transcript renders in the renderer DOM, so scan it for the marker.
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
