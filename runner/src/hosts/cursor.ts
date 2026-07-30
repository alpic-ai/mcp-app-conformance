import { spawn } from "node:child_process";
import { type Browser, chromium } from "playwright";
import type { Page } from "playwright";
import type { CapabilityResult } from "../../../shared/protocol.js";
import { CHANNEL } from "../../../shared/protocol.js";
import type { SetupOptions } from "../host.js";
import { BrowserHost } from "./browser.js";
import { PAGE_LOAD_TIMEOUT_MS, sleep } from "./util.js";

const APP = "/Applications/Cursor.app";
const PORT = 9223;
const ENDPOINT = `http://127.0.0.1:${PORT}`;

// Cursor is an Electron app (VS Code fork) with the same 53KB launcher stub as
// Goose, so `_electron.launch` can't attach; it honours `--remote-debugging-port`,
// so we launch with that flag and attach over CDP. The MCP app renders inside a
// nested `vscode-webview://` iframe once the agent calls run_conformance — the
// mcp-apps-conformance server must be in Cursor's MCP config.
export class CursorBrowserHost extends BrowserHost {
	readonly name = "cursor";
	readonly url = "cursor-desktop"; // unused — open() attaches over CDP, no navigation
	// The suite renders in a nested webview; appFrame() finds it by CHANNEL. This
	// selector is only waitForWidget's readiness gate (any iframe = webview mounted).
	readonly widgetSelector = "iframe";

	private browser?: Browser;

	// ponytail: quits any running Cursor to launch a fresh instance with the CDP
	// port (Electron is single-instance, so a second `open --args` is ignored).
	// Disruptive to an editor session in use — acceptable for a dedicated run.
	protected async open(_opts: SetupOptions): Promise<void> {
		await this.quitCursor();
		await sleep(1_500);
		spawn("open", ["-a", APP, "--args", `--remote-debugging-port=${PORT}`], {
			stdio: "ignore",
			detached: true,
		}).unref();

		const deadline = Date.now() + 30_000;
		let upFlag = false;
		while (Date.now() < deadline) {
			try {
				await (await fetch(`${ENDPOINT}/json/version`)).json();
				upFlag = true;
				break;
			} catch {
				await sleep(1_000);
			}
		}
		if (!upFlag) throw new Error(`Cursor CDP endpoint never came up on ${ENDPOINT}`);

		this.browser = await chromium.connectOverCDP(ENDPOINT);
		const ctx = this.browser.contexts()[0];
		this.context = ctx;
		this.page =
			ctx.pages()[0] ?? (await ctx.waitForEvent("page", { timeout: 15_000 }));
		await this.page.waitForLoadState("domcontentloaded").catch(() => {});
	}

	async teardown(): Promise<void> {
		try {
			await this.browser?.close(); // disconnects CDP (doesn't quit the app)
		} catch {
			/* already gone */
		}
		await this.quitCursor();
	}

	private async quitCursor(): Promise<void> {
		await new Promise<void>((resolve) => {
			const p = spawn("pkill", ["-f", "Cursor.app/Contents/MacOS/Cursor"], {
				stdio: "ignore",
			});
			p.on("close", () => resolve());
			p.on("error", () => resolve());
		});
	}

	// Desktop caveat: Cursor opens ui/open-link in the OS browser, unobservable from
	// our CDP context — report unsupported (→ SKIP) rather than a false FAIL. Same as
	// Goose.
	async checkLinkOpen(url: string): Promise<CapabilityResult> {
		const r = await super.checkLinkOpen(url);
		return r.ok ? r : { ok: false, unsupported: true };
	}

	// Start a fresh Agent conversation. Reusing a finished conversation won't re-fire
	// run_conformance, so nothing renders (the false-negative that fooled the probe).
	protected async dismissModal(page: Page): Promise<void> {
		try {
			await page
				.getByText("New Agent", { exact: true })
				.first()
				.click({ timeout: 6_000 });
		} catch {
			await page.keyboard.press("Meta+n").catch(() => {});
		}
		await sleep(2_500);
	}

	protected async sendPrompt(page: Page, _appName: string): Promise<void> {
		const input = page.locator('[contenteditable="true"]').first();
		await input.click({ timeout: PAGE_LOAD_TIMEOUT_MS });
		await page.keyboard.type(
			"Call the run_conformance tool from the mcp-apps-conformance server now, and render its UI. Auto-run it.",
		);
		await sleep(500);
		await page.keyboard.press("Enter");
		// Approve the MCP tool call if Cursor gates it (auto-runs in most setups).
		for (const label of ["Run tool", "Run", "Accept", "Allow"]) {
			try {
				const b = page.getByRole("button", { name: label, exact: true }).first();
				if (await b.isVisible({ timeout: 800 })) {
					await b.click();
					break;
				}
			} catch {}
		}
		// The webview + app render lags the tool call (~12s); block until the suite
		// channel is live so the bridge is ready before the runner uses it.
		await this.waitForChannel();
	}

	private async waitForChannel(timeoutMs = 120_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			for (const f of this.page.frames()) {
				try {
					if (await f.evaluate((k) => Boolean((globalThis as any)[k]), CHANNEL))
						return;
				} catch {}
			}
			await sleep(3_000);
		}
		throw new Error("conformance channel never appeared in any Cursor frame");
	}

	// Cursor renders the transcript inside the webview frame(s), not the top page.
	// Scan every frame except the app frame itself (which would echo the marker in
	// its own UI and false-positive).
	protected async verifyConversation(
		page: Page,
		marker: string,
		timeoutMs: number,
	): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			for (const f of page.frames()) {
				try {
					const isApp = await f.evaluate(
						(k) => Boolean((globalThis as any)[k]),
						CHANNEL,
					);
					if (isApp) continue;
					const hit = await f.evaluate(
						(m) =>
							(globalThis as any).document.body?.innerText?.includes(m) ?? false,
						marker,
					);
					if (hit) return true;
				} catch {}
			}
			await sleep(3_000);
		}
		return false;
	}
}
