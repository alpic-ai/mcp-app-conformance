import type { BrowserContext, ElementHandle, Frame, Page } from "playwright";
import { chromium } from "playwright";
import type { CapabilityResult } from "../../../shared/protocol.js";
import { CHANNEL } from "../../../shared/protocol.js";
import type { Host, SetupOptions, SuiteBridge } from "../host.js";
import { CLICK_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS, sleep } from "./util.js";

export abstract class BrowserHost implements Host {
	abstract readonly name: string;
	abstract readonly url: string;
	abstract readonly widgetSelector: string;

	protected context!: BrowserContext;
	protected page!: Page;
	private recordVideoDir?: string;
	private consoleLines: string[] = [];

	protected abstract sendPrompt(page: Page, appName: string): Promise<void>;
	protected abstract dismissModal(page: Page): Promise<void>;
	protected abstract verifyConversation(
		page: Page,
		marker: string,
		timeoutMs: number,
	): Promise<boolean>;
	protected commitMessage?(page: Page): Promise<void>;

	// Halt any in-flight AI generation so a previous test's turn can't bleed into
	// the next (a still-generating host swallows the next test's message). Called
	// from resetBetweenTests; best-effort no-op unless a host overrides it.
	protected async stopGeneration(_page: Page): Promise<void> {}

	async setup(opts: SetupOptions): Promise<SuiteBridge> {
		this.recordVideoDir = opts.recordVideoDir;
		await this.open(opts);
		await sleep(5_000); // SPA hydration
		await this.dismissModal(this.page);
		await this.sendPrompt(this.page, opts.appName);
		await this.waitForWidget();
		await sleep(8_000); // app init handshake
		return this.bridge();
	}

	// Acquire the page and set this.context/this.page. A web host launches a fresh
	// Chrome and navigates to this.url; a desktop (Electron) host overrides this to
	// attach to a running app over CDP instead (no URL to navigate).
	protected async open(opts: SetupOptions): Promise<void> {
		await this.launch(opts.profileDir);
		await this.page.goto(this.url, { timeout: PAGE_LOAD_TIMEOUT_MS });
	}

	async teardown(): Promise<void> {
		if (this.context) await this.context.close(); // finalizes the video
	}

	async clickTrigger(req: {
		commitDraftedMessage?: boolean;
	}): Promise<CapabilityResult> {
		const ok = await this.realClickTestId("conformance-trigger");
		if (req.commitDraftedMessage && this.commitMessage) {
			await this.commitMessage(this.page);
		}
		return { ok };
	}

	async confirmDialog(
		dialog: "download" | "sampling",
	): Promise<CapabilityResult> {
		const label = { download: "Download", sampling: "Allow" }[dialog];
		return { ok: await this.clickTopPageButton(label) };
	}

	// The accept-button label on the host's open-link consent dialog, if it shows
	// one. Subclasses override when the button reads differently (e.g. "Confirm").
	protected readonly openLinkConsentLabel: string = "Open link";

	// Success is the specific link OPENING, not a dialog: ChatGPT opens directly
	// with no prompt, Claude first shows an "Open link" consent. app.openLink
	// already fired (clickTrigger) from inside the iframe, so the tab may already
	// be open; if not, accept a consent dialog and wait for it. We match THIS url
	// (not just any new tab) so an unrelated tab can't pass. resetBetweenTests
	// closes it afterwards.
	async checkLinkOpen(url: string): Promise<CapabilityResult> {
		const target = url.replace(/\/+$/, "");
		const isTargetTab = () =>
			this.context
				.pages()
				.some(
					(p) =>
						p !== this.page &&
						!p.isClosed() &&
						p.url().replace(/\/+$/, "").startsWith(target),
				);
		if (isTargetTab()) return { ok: true };
		await this.clickTopPageButton(this.openLinkConsentLabel, 8);
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			if (isTargetTab()) return { ok: true };
			await sleep(500);
		}
		return { ok: false };
	}

	// Read the host page's <iframe> elements — their attributes are readable even
	// though the frames' content is cross-origin. `document` has no type here (the
	// runner tsconfig omits the DOM lib), hence the cast.
	//
	// The page-wide counts alone cannot answer the MUST ("All View content MUST be
	// rendered in sandboxed iframes", spec 2026-01-26 L1698): a host that renders
	// the View unsandboxed, while some unrelated iframe on the page carries a
	// sandbox attribute, satisfies them. So we also walk the frame chain that
	// confines the View and report whether any element in it is sandboxed.
	async inspectFrame(): Promise<CapabilityResult> {
		const counts = await this.page.evaluate(() => {
			const d = (globalThis as any).document;
			// Top document only: querySelectorAll does not descend into child
			// documents, which is why these counts miss a nested sandbox proxy.
			const frames = Array.from(d.querySelectorAll("iframe")) as any[];
			const sandboxed = frames.filter((f) => f.hasAttribute("sandbox"));
			return {
				total: frames.length,
				sandboxed: sandboxed.length,
				firstSandbox: sandboxed[0]?.getAttribute("sandbox") ?? null,
			};
		});
		const chain = await this.viewSandboxChain();
		// Chain unresolvable (desktop webviews, a detached frame mid-run): report
		// the capability as unsupported so the suite SKIPs. Asserting a MUST we
		// could not observe would accuse a host that may well be conforming, and a
		// conformance suite must never emit that. The reason travels with it.
		if ("unresolved" in chain)
			return {
				ok: false,
				unsupported: true,
				error: `could not resolve the frame chain confining the View: ${chain.unresolved}`,
				value: counts,
			};
		return { ok: true, value: { ...counts, ...chain } };
	}

	// The sandbox state of the frame chain confining the View, read from the host
	// document. Two things this deliberately does NOT do:
	//
	// - It reads only elements that live in a document the host page can reach.
	//   The chain starts at the View's own frame element and walks outward to the
	//   top document. If a proxy renders the View HTML in a further iframe inside
	//   its own cross-origin document (spec Sandbox proxy, L470-484), that element
	//   is not observable from the host and is not read.
	// - It does not stop at the outermost frame. Sandbox flags are inherited
	//   downward, so a host that puts a layout frame between the top document and
	//   the sandbox proxy is still conforming; checking only the outermost element
	//   would fail it. Any sandboxed ancestor confines the View.
	//
	// Attribute-only, and read as declared: a host sandboxing through a
	// `Content-Security-Policy: sandbox` response header leaves no attribute to
	// read, and an attribute added after the frame was created does not confine it
	// (sandboxing flags are set when the browsing context is created).
	// When the chain cannot be resolved it returns why, so the skip carries a
	// reason instead of hiding a genuine defect behind a silent one.
	private async viewSandboxChain(): Promise<
		| {
				viewChainDepth: number;
				viewSandboxed: boolean;
				viewSandbox: string | null;
				viewSandboxDepth: number | null;
		  }
		| { unresolved: string }
	> {
		const handles: ElementHandle[] = [];
		try {
			const top = this.page.mainFrame();
			// From the View outward: depth 1 is its own element, the last entry is
			// the child of the top document.
			const chain: Frame[] = [];
			for (let f = await this.appFrame(); f !== top; ) {
				chain.push(f);
				const parent = f.parentFrame();
				if (parent === null)
					return {
						unresolved:
							"the View's frame subtree is not rooted at the host's top frame",
					};
				f = parent;
			}
			for (const [i, frame] of chain.entries()) {
				const element = await frame.frameElement();
				handles.push(element);
				const sandbox = await element.getAttribute("sandbox");
				if (sandbox !== null)
					return {
						viewChainDepth: chain.length,
						viewSandboxed: true,
						viewSandbox: sandbox,
						viewSandboxDepth: i + 1,
					};
			}
			return {
				viewChainDepth: chain.length,
				viewSandboxed: false,
				viewSandbox: null,
				viewSandboxDepth: null,
			};
		} catch (err) {
			return { unresolved: String(err) };
		} finally {
			// Best-effort: a dispose failure must not mask the result above.
			for (const h of handles) {
				try {
					await h.dispose();
				} catch {}
			}
		}
	}

	// Scan the buffered host console (captured since launch) for `pattern`.
	async readConsole(
		pattern: string,
		timeoutMs: number,
	): Promise<CapabilityResult> {
		const re = new RegExp(pattern, "i");
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const hit = this.consoleLines.find((l) => re.test(l));
			if (hit) return { ok: true, value: hit };
			if (Date.now() >= deadline) return { ok: false };
			await sleep(500);
		}
	}

	async conversationContains(
		marker: string,
		timeoutMs: number,
	): Promise<CapabilityResult> {
		return { ok: await this.verifyConversation(this.page, marker, timeoutMs) };
	}

	async toggleTheme(to: "light" | "dark"): Promise<CapabilityResult> {
		await this.page.emulateMedia({ colorScheme: to });
		return { ok: true };
	}

	async resetBetweenTests(): Promise<void> {
		await this.page.bringToFront();
		await this.stopGeneration(this.page); // isolation: end the prior turn's generation
		await this.clearHostOverlay();
		// A real click reverts the display mode to inline; hosts gate display-mode
		// changes on a user gesture, so a programmatic reset alone won't work.
		await this.realClickTestId("reset-inline");
		await this.page.emulateMedia({ colorScheme: "light" }); // deterministic start theme
	}

	// headless MUST stay off: headless Chromium drops cross-origin MessagePort
	// transfers, which breaks the ext-apps init handshake.
	private async launch(profileDir: string): Promise<void> {
		this.context = await chromium.launchPersistentContext(profileDir, {
			channel: "chrome",
			headless: false,
			viewport: null, // let the page track the real OS window (scroll/resize/login)
			args: [
				"--disable-blink-features=AutomationControlled", // navigator.webdriver trips bot checks
				"--disable-popup-blocking",
				"--window-size=1440,1000",
			],
			recordVideo: this.recordVideoDir
				? { dir: this.recordVideoDir, size: { width: 1280, height: 720 } }
				: undefined,
		});
		const pages = this.context.pages();
		this.page = pages.length ? pages[0] : await this.context.newPage();
		this.page.on("console", (m) => this.consoleLines.push(m.text()));
	}

	private bridge(): SuiteBridge {
		return {
			hostInfo: async () => {
				const frame = await this.appFrame();
				// Optional call: a not-yet-redeployed view has no hostInfo() → null.
				return frame.evaluate((k) => globalThis[k]?.hostInfo?.() ?? null, CHANNEL);
			},
			listTests: async () => {
				const frame = await this.appFrame();
				return frame.evaluate(
					(k) => globalThis[k]!.listTests(),
					CHANNEL,
				);
			},
			start: async (filter) => {
				const frame = await this.appFrame();
				await frame.evaluate(([k, f]) => globalThis[k]?.start(f), [
					CHANNEL,
					filter ?? null,
				] as [typeof CHANNEL, { manual?: boolean; id?: string } | null]);
			},
			poll: async () => {
				const frame = await this.appFrame();
				return frame.evaluate((k) => globalThis[k]!.poll(), CHANNEL);
			},
			resolve: async (result) => {
				const frame = await this.appFrame();
				await frame.evaluate(([k, r]) => globalThis[k]!.resolve(r), [
					CHANNEL,
					result,
				] as [typeof CHANNEL, CapabilityResult]);
			},
		};
	}

	// The frame running the in-iframe suite (the one that set window[CHANNEL]).
	// Scanning all frames finds it at any nesting depth — the widget-iframe
	// selector alone can miss it (deeper nesting, multiple matching iframes).
	private async appFrame(): Promise<Frame> {
		for (const frame of this.page.frames()) {
			if (frame === this.page.mainFrame()) continue;
			try {
				if (
					await frame.evaluate((k) => Boolean(globalThis[k]), CHANNEL)
				) {
					return frame;
				}
			} catch {}
		}
		throw new Error(`app frame not found (no window[${CHANNEL}])`);
	}

	// Real, trusted cross-origin click on a widget button by data-testid.
	// Gesture-gated effects only fire under a genuine click, so this — not
	// postMessage — drives the triggers.
	private async realClickTestId(testid: string): Promise<boolean> {
		for (let attempt = 0; attempt < 3; attempt++) {
			// Prefer the frame with a pending interaction (the live app instance) so
			// we don't click a stale/detached frame left by a fullscreen remount.
			const frames = this.page
				.frames()
				.filter((f) => f !== this.page.mainFrame());
			const scored: Array<[Frame, boolean]> = [];
			for (const frame of frames)
				scored.push([frame, await this.frameIsLiveApp(frame)]);
			scored.sort((a, b) => Number(b[1]) - Number(a[1]));
			for (const [frame] of scored) {
				try {
					const btn = frame.getByTestId(testid);
					if (await btn.count()) {
						await btn.first().click({ timeout: CLICK_TIMEOUT_MS });
						return true;
					}
				} catch {}
			}
			await sleep(1_000); // a remounting frame; rescan
		}
		return false;
	}

	// True if this frame is the app instance with a pending interaction — the
	// live suite showing the scrim, not a stale/duplicate frame from a remount.
	private async frameIsLiveApp(frame: Frame): Promise<boolean> {
		try {
			return await frame.evaluate((k) => {
				const s = globalThis[k]?.poll();
				return Boolean(s && s.state === "running" && s.request);
			}, CHANNEL);
		} catch {
			return false;
		}
	}

	// Click a control by exact text in a host permission dialog. Role varies:
	// Claude's "Open link" is a <button>, ChatGPT's is an <a> — match either.
	protected async clickTopPageButton(
		label: string,
		timeoutSeconds = 20,
	): Promise<boolean> {
		const deadline = Date.now() + timeoutSeconds * 1_000;
		while (Date.now() < deadline) {
			const candidates = [
				this.page.getByRole("button", { name: label, exact: true }),
				this.page.getByRole("link", { name: label, exact: true }),
				this.page.getByText(label, { exact: true }),
			];
			for (const loc of candidates) {
				try {
					if (await loc.count()) {
						await loc.first().click({ timeout: CLICK_TIMEOUT_MS });
						return true;
					}
				} catch {}
			}
			await sleep(1_000);
		}
		return false;
	}

	// Leave a clean page for the next test: a prior test's host dialog leaves a
	// backdrop that intercepts the next trigger click, and open-link opens a new
	// tab. Close stray tabs and Escape any lingering modal.
	private async clearHostOverlay(): Promise<void> {
		for (const p of this.context.pages()) {
			if (p !== this.page && !p.isClosed()) {
				try {
					await p.close();
				} catch {
					/* already gone */
				}
			}
		}
		for (let i = 0; i < 3; i++) {
			let present: boolean;
			try {
				present = await this.page.evaluate(() =>
					Boolean(
						(globalThis as any).document.querySelector(
							"[role=dialog],[aria-modal=true]",
						),
					),
				);
			} catch {
				return;
			}
			if (!present) return;
			try {
				await this.page.keyboard.press("Escape");
			} catch {
				return;
			}
			await sleep(600);
		}
	}

	private async waitForWidget(
		timeoutSeconds = 90,
		pollMs = 3_000,
	): Promise<void> {
		const deadline = Date.now() + timeoutSeconds * 1_000;
		while (Date.now() < deadline) {
			if (await this.page.locator(this.widgetSelector).count()) return;
			await sleep(pollMs);
		}
		throw new Error(`widget iframe did not appear within ${timeoutSeconds}s`);
	}

	// Poll a browser-side predicate that returns "found" once the marker lands.
	// The host snapshot can lag the dispatched turn by tens of seconds.
	protected async pollMarker(
		page: Page,
		fn: (marker: string) => string | Promise<string>,
		marker: string,
		timeoutMs: number,
		pollMs: number,
	): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			let status: string;
			try {
				status = (await page.evaluate(fn, marker)) as string;
			} catch (err) {
				status = `error: ${err}`;
			}
			console.log(
				`[conformance] conversation check (${marker.slice(0, 24)}…): ${status}`,
			);
			if (status === "found") return true;
			await sleep(pollMs);
		}
		return false;
	}
}
