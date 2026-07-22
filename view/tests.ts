/**
 * The conformance test catalogue (in-view slice).
 *
 * This platform certifies HOSTS, so every test is a host test — IDs are
 * namespaced by spec capability area (lifecycle/, security/, tools/, …),
 * WPT-path style. Each test carries a `vantage` (where it can be observed) and,
 * where relevant, a `caveat` warning about what the result can't distinguish.
 *
 * Automatic tests (`vantage: "in-view"`) measure the host from inside the iframe
 * with `t.assert` / the probes / `t.app.*`. Manual tests emit typed
 * `CapabilityRequest`s (`t.host(...)`) that an external Runner — or a human
 * clicking the UI — resolves.
 */
import type {
	App,
	McpUiSupportedContentBlockModalities,
} from "@modelcontextprotocol/ext-apps";
import { mcp_test, type TestContext } from "./harness/registry";

// Markers the Runner searches for in the host conversation (conversationContains).
const MESSAGE_MARKER = "conformance-msg-b8f1c2e7";
const MODEL_CONTEXT_MARKER = "MCP-APP-7421";

// ── app-provided tool, registered ONCE at connect (see ensureAppToolRegistered) ──
// Registering mid-run inside the last test was unreliable: a host may snapshot the
// app's tool list before then, or mount a fresh widget instance for the follow-up
// turn that never ran the registration — so the agent's call had nowhere to land.
// Registering early keeps `conformance_ping` available for the whole session.
let resolveAppToolCall: (() => void) | null = null;
let appToolRegistered = false;
let appToolRegisterError: string | null = null;

export function ensureAppToolRegistered(app: App): void {
	if (appToolRegistered || appToolRegisterError) return;
	try {
		app.registerTool(
			"conformance_ping",
			{
				title: "Conformance Ping",
				description: "Conformance test tool — returns 'pong'.",
			},
			() => {
				console.log("[conformance] conformance_ping CALLED by host");
				resolveAppToolCall?.();
				return { content: [{ type: "text", text: "pong" }] };
			},
		);
		void app.sendToolListChanged().catch(() => {});
		appToolRegistered = true;
	} catch (e) {
		appToolRegisterError = e instanceof Error ? e.message : String(e);
		console.error("[conformance] app tool registration failed:", appToolRegisterError);
	}
}

function nextAppToolCall(): Promise<void> {
	return new Promise<void>((resolve) => {
		resolveAppToolCall = resolve;
	});
}

// ── lifecycle ──────────────────────────────────────────────────────────────
// After ui/initialize, the host MUST expose its capabilities.
mcp_test(
	"lifecycle/initialize-capabilities",
	"ui/initialize returns hostCapabilities",
	(t: TestContext) => {
		const caps = t.app.getHostCapabilities();
		t.setValue(caps);
		t.assert(
			caps != null,
			"host must return hostCapabilities after the ui/initialize handshake",
		);
	},
	{ clause: "MUST", vantage: "in-view" },
);

// ── context ────────────────────────────────────────────────────────────────
// The host SHOULD include hostContext in the ui/initialize result.
mcp_test(
	"context/initialize-hostcontext",
	"ui/initialize result carries hostContext",
	(t: TestContext) => {
		const ctx = t.app.getHostContext();
		t.setValue(ctx);
		t.assert(
			ctx != null && typeof ctx === "object",
			"host should provide hostContext",
		);
	},
	{
		clause: "SHOULD",
		vantage: "in-view",
		caveat:
			"SHOULD, not MUST — a host may legitimately omit hostContext, which would FAIL here. We assert presence; a richer version would only validate shape when present.",
	},
);

// ── theming (§Theming — all soft; reported as capability signals) ─────────────
// The host MAY pass theme CSS custom properties via hostContext.styles.variables.
mcp_test(
	"context/theme-variables",
	"host provides theme CSS variables (styles.variables)",
	(t: TestContext) => {
		const vars = t.app.getHostContext()?.styles?.variables;
		const keys = vars ? Object.keys(vars) : [];
		t.assert(keys.length > 0, "host provided no style variables");
	},
	{
		clause: "MAY",
		vantage: "in-view",
		caveat:
			"Optional (MAY). Signal only — inspect the exact values in the Inspector panel.",
	},
);

// The host SHOULD use CSS light-dark() for theme-aware values — only observable
// when styles.variables are passed, so reported as a signal rather than a fail.
mcp_test(
	"context/light-dark",
	"theme-aware values use CSS light-dark()",
	(t: TestContext) => {
		const values = Object.values(
			t.app.getHostContext()?.styles?.variables ?? {},
		);
		t.assert(
			values.length > 0,
			"host provided no style variables to check for light-dark()",
		);
		const usesLightDark = values.some(
			(v) => typeof v === "string" && v.includes("light-dark("),
		);
		t.assert(
			usesLightDark,
			"host provides style variables but none use light-dark()",
		);
	},
	{
		clause: "SHOULD",
		vantage: "in-view",
		caveat:
			"SHOULD, and only observable when the host passes style variables. Non-color variables (radii, shadows) legitimately don't use light-dark(), so this is a signal, not a hard fail.",
	},
);

// The host MAY provide custom fonts via hostContext.styles.css.fonts.
mcp_test(
	"context/theme-fonts",
	"host provides custom fonts (styles.css.fonts)",
	(t: TestContext) => {
		const fonts = t.app.getHostContext()?.styles?.css?.fonts;
		t.assert(!!fonts, "host provided no custom fonts");
	},
	{
		clause: "MAY",
		vantage: "in-view",
		caveat:
			"Optional (MAY). Signal only — inspect the font CSS in the Inspector panel.",
	},
);

// ── tools ──────────────────────────────────────────────────────────────────
// The host MUST proxy tools/call from the view to the server and return the
// result (App → Host → Server → Host → App).
mcp_test(
	"tools/proxy-call",
	"host proxies tools/call to the server",
	async (t: TestContext) => {
		const res = await t.app.callServerTool({
			name: "conformance_probe",
			arguments: { ping: "hello-from-view" },
		});
		const text = (res.content ?? [])
			.map((c) => (c.type === "text" ? c.text : ""))
			.join("");
		t.assert(
			text.includes("hello-from-view"),
			`expected the proxied tool result to echo the payload, got: ${JSON.stringify(text)}`,
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		caveat:
			"The server also sees this call directly, so it can be corroborated server-side.",
	},
);

// ── visibility ─────────────────────────────────────────────────────────────
// The host MUST reject tools/call from an app for a tool that doesn't include
// "app" in its visibility. `model_only_probe` is a model-only fixture tool.
mcp_test(
	"visibility/app-tool-call-guard",
	"host rejects app call to a model-only tool",
	async (t: TestContext) => {
		const rejected = await t.expectToolRejected("model_only_probe", {
			ping: "x",
		});
		t.assert(
			rejected,
			'host must reject an app\'s tools/call for a tool lacking "app" visibility',
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		caveat:
			"Covers the app→tool direction only. The complementary `visibility/app-tool-hidden` (tool absent from the *agent's* list) needs the agent vantage and isn't measurable here.",
	},
);

// ── display ────────────────────────────────────────────────────────────────
// The host MUST return the resulting mode in the ui/request-display-mode response.
mcp_test(
	"display/return-resulting-mode",
	"ui/request-display-mode returns the resulting mode",
	async (t: TestContext) => {
		const original = t.app.getHostContext()?.displayMode ?? "inline";
		t.addCleanup(async () => {
			await t.app.requestDisplayMode({ mode: original });
		});
		const res = (await t.app.requestDisplayMode({ mode: "inline" })) as {
			mode?: unknown;
		};
		t.assert(
			typeof res?.mode === "string" &&
				["inline", "fullscreen", "pip"].includes(res.mode),
			`host must return a valid resulting display mode, got: ${JSON.stringify(res?.mode)}`,
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		caveat:
			"Requests the current mode ('inline') to avoid a disruptive change, but a host may still re-render as a side effect.",
	},
);

// ── batch A: more in-view tests ──────────────────────────────────────────────

// security — the sandbox proxy MUST be a different origin from the host, so
// reading the parent's location throws a cross-origin SecurityError.
mcp_test(
	"security/sandbox-distinct-origin",
	"host and sandbox have different origins",
	(t: TestContext) => {
		// The View is loaded same-origin INSIDE the Sandbox proxy (window.parent),
		// so the spec's Host ≠ Sandbox boundary (§Sandbox proxy) is between the
		// Sandbox/View and window.top (the Host). Reading window.parent would NOT
		// throw (same origin); reading the host's location must throw cross-origin.
		t.assert(
			window.top !== window.self,
			"not embedded in a host frame (window.top === self)",
		);
		let threw = false;
		try {
			void window.top?.location.href;
		} catch {
			threw = true;
		}
		t.assert(
			threw,
			"reading window.top.location (the host) must throw — host and sandbox must have different origins",
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		caveat:
			"Host ≠ Sandbox. The View runs same-origin inside the Sandbox, so this checks window.top (the host), not window.parent (the sandbox). Opened top-level (no host), window.top === self and this FAILs — correct, it's not in a host.",
	},
);

// security — the sandbox MUST grant allow-scripts + allow-same-origin.
mcp_test(
	"security/sandbox-permissions",
	"sandbox grants allow-scripts + allow-same-origin",
	(t: TestContext) => {
		// This code executing ⇒ allow-scripts. A non-opaque origin ⇒ allow-same-origin.
		t.assert(
			window.origin !== "null",
			"sandbox must grant allow-same-origin (window.origin must not be the opaque 'null')",
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		caveat:
			"Inferred: scripts executing ⇒ allow-scripts; non-opaque window.origin ⇒ allow-same-origin.",
	},
);

// lifecycle — host MUST send ui/notifications/tool-input after the View inits.
mcp_test(
	"lifecycle/tool-input",
	"host sends tool-input after initialize",
	async (t: TestContext) => {
		const params = await t.signals.toolInput;
		t.assert(
			params !== undefined,
			"host must send a ui/notifications/tool-input with the tool arguments",
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		timeoutMs: 4000,
		caveat:
			"Captured via the ontoolinput callback (registered before connect). TIMEOUT means the host never sent it for the launching tool.",
	},
);

// lifecycle — host MUST send ui/notifications/tool-result on completion.
mcp_test(
	"lifecycle/tool-result",
	"host sends tool-result on completion",
	async (t: TestContext) => {
		const result = await t.signals.toolResult;
		t.assert(
			result !== undefined,
			"host must send a ui/notifications/tool-result when the tool completes",
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		timeoutMs: 4000,
		caveat:
			"Captured via ontoolresult. Some hosts may not replay tool-result for the tool that launched the view — TIMEOUT flags that.",
	},
);

// lifecycle — host MUST stop sending tool-input-partial once tool-input is sent.
mcp_test(
	"lifecycle/tool-input-partial-stop",
	"host stops tool-input-partial once tool-input is sent",
	async (t: TestContext) => {
		// Wait (bounded) for tool-input so "after" is well-defined, then leave a
		// brief window to catch any illegal late partial.
		await Promise.race([
			t.signals.toolInput,
			new Promise((r) => setTimeout(r, 1500)),
		]);
		await new Promise((r) => setTimeout(r, 300));
		t.assert(
			!t.signals.partials.sawAfterToolInput,
			`host must not send ui/notifications/tool-input-partial after tool-input (observed ${t.signals.partials.count} partial(s))`,
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		timeoutMs: 4000,
		caveat:
			"Only catches a violation if the host actually streams partials; our launcher tool has no streamable args, so this usually passes vacuously (0 partials observed).",
	},
);

// The ext-apps SDK strictly validates the host's requestDisplayMode RESULT
// against the spec schema (`mode` ∈ inline|fullscreen|pip, required). A
// non-conforming host (observed on Cursor) replies without a valid `mode`,
// which makes the SDK throw a Zod error mid-call. Catch it so the test reports
// a clean conformance verdict instead of a raw validation dump.
type ModeResult = { ok: true; mode: unknown } | { ok: false; error: string };
async function requestMode(
	app: TestContext["app"],
	mode: "inline" | "fullscreen" | "pip",
): Promise<ModeResult> {
	try {
		const res = (await app.requestDisplayMode({ mode })) as { mode?: unknown };
		return { ok: true, mode: res?.mode };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

// display — host MUST NOT switch to a mode absent from availableDisplayModes.
// The runner declares only inline/fullscreen, so 'pip' is undeclared.
mcp_test(
	"display/no-undeclared-mode",
	"host does not switch to an undeclared display mode",
	async (t: TestContext) => {
		const original = t.app.getHostContext()?.displayMode ?? "inline";
		t.addCleanup(async () => {
			await t.app.requestDisplayMode({ mode: original });
		});
		const res = await requestMode(t.app, "pip");
		// A malformed/rejected result means the host did not switch to pip — which
		// is exactly what MUST NOT requires, so it passes.
		const mode = res.ok ? res.mode : undefined;
		t.assert(
			mode !== "pip",
			"host must not switch the view to a mode it didn't declare (pip)",
		);
	},
	{
		clause: "MUST NOT",
		vantage: "in-view",
		caveat:
			"We declare only inline/fullscreen in appCapabilities, then request the undeclared 'pip'.",
	},
);

// display — for an unavailable mode request, host SHOULD return the current mode.
mcp_test(
	"display/unavailable-returns-current",
	"unavailable mode request returns the current mode",
	async (t: TestContext) => {
		const current = t.app.getHostContext()?.displayMode ?? "inline";
		t.addCleanup(async () => {
			await t.app.requestDisplayMode({ mode: current });
		});
		const res = await requestMode(t.app, "pip");
		t.assert(
			res.ok,
			`host returned a malformed result with no valid mode for an unavailable request${res.ok ? "" : `: ${res.error}`}`,
		);
		t.assertEquals(
			res.mode,
			current,
			"host should return the current display mode for an unavailable request",
		);
	},
	{
		clause: "SHOULD",
		vantage: "in-view",
		caveat:
			"SHOULD — assumes the current mode is stable between reading hostContext and the request.",
	},
);

// ── security · CSP ───────────────────────────────────────────────────────────
// The runner resource declares `_meta.ui.csp.connectDomains: ["…/modelcontextprotocol.io"]`,
// so these two form a positive/negative pair: the allowed origin proves
// connectivity works, so a block of the undeclared origin can only be the CSP
// (not a network failure). (The "omitted CSP → restrictive default" case,
// security/csp-default-deny, needs a no-CSP resource and is deferred.)
const CSP_ALLOWED = "https://modelcontextprotocol.io/";
const CSP_UNDECLARED = "https://example.com/";

// security — a declared connectDomains origin MUST be permitted (positive control).
mcp_test(
	"security/csp-allow-declared",
	"declared connectDomains origin is allowed",
	async (t: TestContext) => {
		const allowed = !(await t.expectFetchBlocked(CSP_ALLOWED));
		t.assert(
			allowed,
			`a fetch to the declared origin ${CSP_ALLOWED} must be allowed by the host's CSP`,
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		caveat: `The runner declares connectDomains: ["${CSP_ALLOWED}"]. ⚠️ a network failure also reads as "not allowed", so the origin must be reachable.`,
	},
);

// security — even with a CSP declared, an UNDECLARED origin MUST stay blocked.
mcp_test(
	"security/csp-no-loosening",
	"undeclared origin stays blocked when a CSP is declared",
	async (t: TestContext) => {
		const blocked = await t.expectFetchBlocked(CSP_UNDECLARED);
		t.assert(
			blocked,
			`the host must not allow the undeclared origin ${CSP_UNDECLARED} (no loosening beyond declared domains)`,
		);
	},
	{
		clause: "MUST NOT",
		vantage: "in-view",
		caveat: `Backed by csp-allow-declared as the positive control: the declared origin works, so blocking this one is genuinely the CSP, not a blanket fetch failure.`,
	},
);

// security — the host MUST build the CSP from the declared domains. Reads the
// actual applied policy (not just behaviour) via meta tag / securitypolicyviolation.
mcp_test(
	"security/csp-construct-from-domains",
	"host constructs the CSP from the declared domains",
	async (t: TestContext) => {
		const csp = await t.readAppliedCsp();
		t.assert(
			csp !== null,
			"could not read the applied CSP (no <meta> tag and no securitypolicyviolation fired)",
		);
		t.assert(
			/connect-src[^;]*modelcontextprotocol\.io/i.test(csp!),
			`the constructed CSP's connect-src must include the declared domain; got: ${csp}`,
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		caveat:
			"Reads the applied CSP via a <meta> tag or the securitypolicyviolation event's originalPolicy. ⚠️ if the host delivers CSP only by HTTP header and no violation fires (or originalPolicy is redacted), it can't be read.",
	},
);

// ── dimensions ───────────────────────────────────────────────────────────────
// In flexible mode the host MUST resize the iframe when the view reports a new
// size. The view can't read its outer iframe, but the host's resize changes the
// view's own window.innerHeight (and fires a resize event). We grow the content
// (autoResize reports it) and watch our viewport grow.
mcp_test(
	"dimensions/listen-size-changed",
	"host resizes the iframe on size-changed (flexible mode)",
	async (t: TestContext) => {
		const dims = t.app.getHostContext()?.containerDimensions as
			| { height?: number }
			| undefined;
		if (dims && typeof dims.height === "number") {
			// Host pinned a fixed height — flexible-mode resize doesn't apply, so
			// there's nothing to fail here (valid host choice); pass and return.
			return;
		}
		const before = window.innerHeight;
		const spacer = document.createElement("div");
		spacer.style.height = "320px";
		spacer.setAttribute("aria-hidden", "true");
		document.body.appendChild(spacer);
		t.addCleanup(() => spacer.remove());
		// Wait for autoResize → host resize → our viewport to grow.
		await new Promise<void>((resolve) => {
			const finish = () => {
				window.removeEventListener("resize", onResize);
				clearTimeout(timer);
				resolve();
			};
			const onResize = () => {
				if (window.innerHeight > before) finish();
			};
			const timer = setTimeout(finish, 2500);
			window.addEventListener("resize", onResize);
		});
		t.assert(
			window.innerHeight > before,
			`host must grow the iframe when the view reports a larger size (was ${before}px, now ${window.innerHeight}px)`,
		);
	},
	{
		clause: "MUST",
		vantage: "in-view",
		timeoutMs: 5000,
		caveat:
			"Flexible mode only (returns vacuously if the host pins a fixed height). Relies on autoResize reporting the taller content and the view's window.innerHeight reflecting the resize; the host may clamp to maxHeight.",
	},
);

// ── capabilities ─────────────────────────────────────────────────────────────
// The host MAY forward non-ui/ MCP methods from the view to the server. We test
// this with resources/list (distinct from tools/proxy-call's tools/call): the
// view calls listServerResources → the host must forward it → we get the
// server's own ui:// resource back.
mcp_test(
	"capabilities/server-passthrough",
	"host forwards resources/list from the view to the server",
	async (t: TestContext) => {
		t.assert(
			!!t.app.getHostCapabilities()?.serverResources,
			"host does not advertise serverResources — resource passthrough not supported",
		);
		const res = await t.app.listServerResources();
		const uris = (res.resources ?? []).map((r) => r.uri);
		t.assert(
			uris.includes("ui://conformance/runner"),
			`host must forward resources/list to the server (expected ui://conformance/runner, got: ${JSON.stringify(uris)})`,
		);
	},
	{
		clause: "SHOULD",
		vantage: "in-view",
		caveat:
			"Exercises resources/list passthrough (distinct from tools/proxy-call's tools/call). Gated on the host advertising serverResources.",
	},
);

// ── interactive · manual (host round-trip via CapabilityRequest) ──────────────
// The host emits ui/notifications/context-changed when context fields change.
// The Runner flips the host theme; we resolve as soon as the view sees a
// hostcontextchanged notification.
mcp_test(
	"context/context-changed",
	"host notifies the view when the theme changes",
	async (t: TestContext) => {
		for (const to of ["dark", "light"] as const) {
			const changed = t.awaitHostContextChanged();
			await t.host({ kind: "toggleTheme", to });
			if (await t.settled(changed, 15_000)) return;
		}
		t.skip("host did not emit context-changed (may be pinned, not on System)");
	},
	{
		clause: "MAY",
		vantage: "in-view",
		manual: true,
		timeoutMs: 0,
		caveat:
			"The Runner toggles the host theme and the view resolves on the hostcontextchanged notification. SKIP if the host doesn't emit it (e.g. theme pinned, not following the OS).",
	},
);

// ── interactive · manual (host round-trip via CapabilityRequest) ──────────────
// The host opens ui/open-link URLs in the user's browser / a new tab. The
// sandboxed view can't observe a new tab (host vantage), so the Runner clicks the
// trigger and confirms the host surfaced/accepted the open-link dialog.
mcp_test(
	"links/open-external",
	"ui/open-link opens the URL",
	async (t: TestContext) => {
		t.bindTrigger(() => t.app.openLink({ url: "https://modelcontextprotocol.io/" }));
		await t.host({ kind: "clickTrigger" });
		const r = await t.host({ kind: "confirmDialog", dialog: "open-link" });
		t.assert(r.ok, "host did not surface/accept the open-link dialog");
	},
	{
		clause: "SHOULD",
		vantage: "host",
		manual: true,
		timeoutMs: 0,
		caveat:
			"Host-vantage: the sandboxed view can't see the host open a tab, so the Runner triggers ui/open-link and confirms the host surfaced/accepted it.",
	},
);

// messages — host adds a ui/message to the conversation. The view can't read the
// host's conversation, so the Runner triggers it (committing any drafted message)
// and confirms the marker appeared.
mcp_test(
	"messages/add-to-conversation",
	"ui/message is added to the conversation",
	async (t: TestContext) => {
		t.assert(
			!!t.app.getHostCapabilities()?.message,
			"host does not advertise ui/message",
		);
		t.bindTrigger(() =>
			t.app.sendMessage({
				role: "user",
				content: [{ type: "text", text: MESSAGE_MARKER }],
			}),
		);
		await t.host({ kind: "clickTrigger", commitDraftedMessage: true });
		const r = await t.host({
			kind: "conversationContains",
			marker: MESSAGE_MARKER,
			timeoutMs: 120_000,
		});
		t.assert(r.ok, "ui/message never appeared in the conversation");
	},
	{
		clause: "SHOULD",
		vantage: "host",
		manual: true,
		timeoutMs: 0,
		caveat:
			"Host-vantage: the view can't read the host's conversation, so the Runner confirms the marker appeared (some hosts draft into the composer — commitDraftedMessage sends it).",
	},
);

// visibility — app-only tools (visibility lacking "model") must be hidden from
// the agent's tool list. Prefer the direct desktop-host affordance; else fall
// back to asking the agent to enumerate its tools and confirm the name is absent.
mcp_test(
	"visibility/app-tool-hidden",
	"host hides app-only tools from the agent",
	async (t: TestContext) => {
		const direct = await t.hostOptional({ kind: "readModelToolList" });
		if (!direct.unsupported) {
			t.assert(
				!(direct.value as string[]).includes("conformance_probe"),
				"app-only tool `conformance_probe` is present in the model's tool list (must be hidden)",
			);
			return;
		}
		t.assert(
			!!t.app.getHostCapabilities()?.message,
			"host does not advertise ui/message",
		);
		t.bindTrigger(() =>
			t.app.sendMessage({
				role: "user",
				content: [
					{
						type: "text",
						text: "From the MCP Apps Conformance server specifically, list every tool you can call, by name (ignore tools from other connected servers).",
					},
				],
			}),
		);
		await t.host({ kind: "clickTrigger", commitDraftedMessage: true });
		const r = await t.host({
			kind: "conversationContains",
			marker: "conformance_probe",
			timeoutMs: 45_000,
		});
		t.assert(!r.ok, "hidden tool name `conformance_probe` surfaced in the conversation");
	},
	{
		clause: "MUST NOT",
		vantage: "host",
		manual: true,
		timeoutMs: 0,
		caveat:
			'`conformance_probe` is app-only (visibility ["app"]) so it must not be in the model-facing tools/list. Uses the desktop-host tool-list affordance if available, else the agent\'s own (truthful) enumeration.',
	},
);

// model-context — context provided via ui/update-model-context must reach the
// model on a future turn. The app seeds a secret code, then asks the agent for
// it; the Runner confirms the agent recalled it in the conversation.
mcp_test(
	"model-context/provide-future-turns",
	"ui/update-model-context reaches the model next turn",
	async (t: TestContext) => {
		t.assert(
			!!t.app.getHostCapabilities()?.updateModelContext,
			"host does not advertise ui/update-model-context",
		);
		t.bindTrigger(async () => {
			await t.app.updateModelContext({
				content: [
					{
						type: "text",
						text: `The secret conformance code is ${MODEL_CONTEXT_MARKER}. Remember it for later.`,
					},
				],
			});
			await t.app.sendMessage({
				role: "user",
				content: [
					{ type: "text", text: "What is the secret conformance code I gave you?" },
				],
			});
		});
		await t.host({ kind: "clickTrigger", commitDraftedMessage: true });
		const r = await t.host({
			kind: "conversationContains",
			marker: MODEL_CONTEXT_MARKER,
			timeoutMs: 120_000,
		});
		t.assert(r.ok, "the model did not receive the seeded context on the next turn");
	},
	{
		clause: "SHOULD",
		vantage: "host",
		manual: true,
		timeoutMs: 0,
		caveat:
			"Multi-turn, host-vantage: seeds ui/update-model-context then asks the agent to recall it; confirms the host fed the context to the model on the following turn.",
	},
);

// ── draft (specification/draft — unstable, may change) ───────────────────────
// The host declares which content-block modalities it accepts for message /
// update-model-context via SupportedContentBlockModalities. Read-only signal.
mcp_test(
	"capabilities/content-modalities",
	"host declares content-block modalities for message / update-model-context",
	(t: TestContext) => {
		const caps = t.app.getHostCapabilities();
		const fmt = (m?: McpUiSupportedContentBlockModalities) =>
			m ? Object.keys(m).join(", ") || "(present, empty)" : "not declared";
		t.assert(
			Boolean(caps?.message || caps?.updateModelContext),
			`host declares no content-block modalities (message: ${fmt(caps?.message)} · updateModelContext: ${fmt(caps?.updateModelContext)})`,
		);
	},
	{
		clause: "MAY",
		vantage: "in-view",
		caveat:
			"Draft (specification/draft). Signal only — reports the SupportedContentBlockModalities the host advertises.",
	},
);

// The host answers sampling/createMessage from the view (host runs its own LLM).
// Capability-gated; the host has discretion (model choice, rate-limit, approval).
mcp_test(
	"sampling/create-message",
	"sampling/createMessage returns a completion",
	async (t: TestContext) => {
		t.assert(
			!!t.app.getHostCapabilities()?.sampling,
			"host does not advertise the sampling capability",
		);
		t.bindTrigger(async () => {
			const res = await t.app.createSamplingMessage({
				messages: [
					{
						role: "user",
						content: { type: "text", text: "Reply with the single word: pong." },
					},
				],
				maxTokens: 16,
			});
			console.log("[conformance] sampling result:", res);
		});
		await t.host({ kind: "clickTrigger" });
		const r = await t.host({ kind: "confirmDialog", dialog: "sampling" });
		t.assert(r.ok, "host did not surface/accept the sampling request");
	},
	{
		clause: "SHOULD",
		vantage: "host",
		manual: true,
		timeoutMs: 0,
		caveat:
			"Draft. Capability-gated. The host has full discretion (model selection, rate limiting, user approval); the Runner triggers the call, may approve it, and confirms the reply.",
	},
);

// The host performs a host-mediated file download for ui/download-file (direct
// downloads are blocked in the sandbox). The download + any confirmation dialog
// happen outside the iframe, so the Runner confirms.
mcp_test(
	"download-file/confirm",
	"ui/download-file downloads a file",
	async (t: TestContext) => {
		t.assert(
			!!t.app.getHostCapabilities()?.downloadFile,
			"host does not advertise the downloadFile capability",
		);
		t.bindTrigger(() =>
			t.app.downloadFile({
				contents: [
					{
						type: "resource",
						resource: {
							uri: "ui://conformance/hello.txt",
							mimeType: "text/plain",
							text: "MCP Apps conformance — download test.",
						},
					},
				],
			}),
		);
		await t.host({ kind: "clickTrigger" });
		const r = await t.host({ kind: "confirmDialog", dialog: "download" });
		t.assert(r.ok, "host did not surface/accept the download");
	},
	{
		clause: "SHOULD",
		vantage: "host",
		manual: true,
		timeoutMs: 0,
		caveat:
			"Draft. Host-vantage: the download and its confirmation dialog occur outside the sandboxed iframe, so the Runner confirms.",
	},
);

// App-Provided Tools: the app registers a tool and the host/agent calls it
// (Host→App tools/call). The Runner asks the agent to invoke it; the harness
// detects the registered callback firing.
mcp_test(
	"app-tools/call",
	"host calls an app-registered tool",
	async (t: TestContext) => {
		// conformance_ping is registered once at connect (ensureAppToolRegistered).
		// If registration itself can't occur, fail immediately — there's nothing to
		// wait for (no point asking the agent to call a tool that never registered).
		ensureAppToolRegistered(t.app);
		t.assert(
			appToolRegistered,
			`app tool registration failed: ${appToolRegisterError ?? "unknown error"}`,
		);
		t.bindTrigger(() =>
			t.app.sendMessage({
				role: "user",
				content: [
					{
						type: "text",
						text: 'Call the app tool named "conformance_ping" now (it is provided by the MCP Apps Conformance server).',
					},
				],
			}),
		);
		await t.host({ kind: "clickTrigger", commitDraftedMessage: true });
		const called = await t.settled(nextAppToolCall(), 25_000);
		t.assert(called, "the agent did not call the app-registered tool conformance_ping");
	},
	{
		clause: "MAY",
		vantage: "in-view",
		manual: true,
		timeoutMs: 0,
		caveat:
			"Draft (App-Provided Tools). Requires the host to expose app-registered tools to the agent; the Runner asks the agent to call it and the harness detects the callback.",
	},
);
