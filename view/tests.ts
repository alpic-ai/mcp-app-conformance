/**
 * The conformance test catalogue (in-view slice).
 *
 * This platform certifies HOSTS, so every test is a host test — IDs are
 * namespaced by spec capability area (lifecycle/, security/, tools/, …),
 * WPT-path style. Each test carries a `vantage` (where it can be observed) and,
 * where relevant, a `caveat` warning about what the result can't distinguish.
 *
 * Everything here is `vantage: "in-view"` — measurable from inside the iframe.
 * Requirements needing the server's or the agent's vantage live in the README
 * catalogue and will be covered by server-side judging / an agent harness.
 */
import { mcp_test, type TestContext } from "./testharness";

// ── lifecycle ──────────────────────────────────────────────────────────────
// After ui/initialize, the host MUST expose its capabilities.
mcp_test(
  "lifecycle/initialize-capabilities",
  "ui/initialize returns hostCapabilities",
  (t: TestContext) => {
    const caps = t.app.getHostCapabilities();
    t.assert(caps != null, "host must return hostCapabilities after the ui/initialize handshake");
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
    t.assert(ctx != null && typeof ctx === "object", "host should provide hostContext");
  },
  {
    clause: "SHOULD",
    vantage: "in-view",
    caveat:
      "SHOULD, not MUST — a host may legitimately omit hostContext, which would FAIL here. We assert presence; a richer version would only validate shape when present.",
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
    caveat: "The server also sees this call directly, so it can be corroborated server-side.",
  },
);

// ── visibility ─────────────────────────────────────────────────────────────
// The host MUST reject tools/call from an app for a tool that doesn't include
// "app" in its visibility. `model_only_probe` is a model-only fixture tool.
mcp_test(
  "visibility/app-tool-call-guard",
  "host rejects app call to a model-only tool",
  async (t: TestContext) => {
    const rejected = await t.expectToolRejected("model_only_probe", { ping: "x" });
    t.assert(rejected, "host must reject an app's tools/call for a tool lacking \"app\" visibility");
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
    t.addCleanup(async () => { await t.app.requestDisplayMode({ mode: original }); });
    const res = (await t.app.requestDisplayMode({ mode: "inline" })) as { mode?: unknown };
    t.assert(
      typeof res?.mode === "string" && ["inline", "fullscreen", "pip"].includes(res.mode),
      `host must return a valid resulting display mode, got: ${JSON.stringify(res?.mode)}`,
    );
  },
  {
    clause: "MUST",
    vantage: "in-view",
    caveat: "Requests the current mode ('inline') to avoid a disruptive change, but a host may still re-render as a side effect.",
  },
);

// ── batch A: more in-view tests ──────────────────────────────────────────────

// security — the sandbox proxy MUST be a different origin from the host, so
// reading the parent's location throws a cross-origin SecurityError.
mcp_test(
  "security/sandbox-distinct-origin",
  "host and sandbox have different origins",
  (t: TestContext) => {
    let threw = false;
    try {
      void window.parent.location.href;
    } catch {
      threw = true;
    }
    t.assert(threw, "reading window.parent.location must throw (cross-origin sandbox proxy)");
  },
  {
    clause: "MUST",
    vantage: "in-view",
    caveat:
      "Inferred from a cross-origin SecurityError. If the page were opened top-level (no host), parent === self and this would FAIL — which is correct (it's not in a host).",
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
    caveat: "Inferred: scripts executing ⇒ allow-scripts; non-opaque window.origin ⇒ allow-same-origin.",
  },
);

// lifecycle — host MUST send ui/notifications/tool-input after the View inits.
mcp_test(
  "lifecycle/tool-input",
  "host sends tool-input after initialize",
  async (t: TestContext) => {
    const params = await t.signals.toolInput;
    t.assert(params !== undefined, "host must send a ui/notifications/tool-input with the tool arguments");
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
    t.assert(result !== undefined, "host must send a ui/notifications/tool-result when the tool completes");
  },
  {
    clause: "MUST",
    vantage: "in-view",
    timeoutMs: 4000,
    caveat:
      "Captured via ontoolresult. Some hosts may not replay tool-result for the tool that launched the view — TIMEOUT flags that.",
  },
);

// display — host MUST NOT switch to a mode absent from availableDisplayModes.
// The runner declares only inline/fullscreen, so 'pip' is undeclared.
mcp_test(
  "display/no-undeclared-mode",
  "host does not switch to an undeclared display mode",
  async (t: TestContext) => {
    const original = t.app.getHostContext()?.displayMode ?? "inline";
    t.addCleanup(async () => { await t.app.requestDisplayMode({ mode: original }); });
    const res = (await t.app.requestDisplayMode({ mode: "pip" })) as { mode?: unknown };
    t.assert(res?.mode !== "pip", "host must not switch the view to a mode it didn't declare (pip)");
  },
  {
    clause: "MUST NOT",
    vantage: "in-view",
    caveat: "We declare only inline/fullscreen in appCapabilities, then request the undeclared 'pip'.",
  },
);

// display — for an unavailable mode request, host SHOULD return the current mode.
mcp_test(
  "display/unavailable-returns-current",
  "unavailable mode request returns the current mode",
  async (t: TestContext) => {
    const current = t.app.getHostContext()?.displayMode ?? "inline";
    t.addCleanup(async () => { await t.app.requestDisplayMode({ mode: current }); });
    const res = (await t.app.requestDisplayMode({ mode: "pip" })) as { mode?: unknown };
    t.assertEquals(res?.mode, current, "host should return the current display mode for an unavailable request");
  },
  {
    clause: "SHOULD",
    vantage: "in-view",
    caveat: "SHOULD — assumes the current mode is stable between reading hostContext and the request.",
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
    const allowed = await t.expectFetchAllowed(CSP_ALLOWED);
    t.assert(allowed, `a fetch to the declared origin ${CSP_ALLOWED} must be allowed by the host's CSP`);
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
    t.assert(blocked, `the host must not allow the undeclared origin ${CSP_UNDECLARED} (no loosening beyond declared domains)`);
  },
  {
    clause: "MUST NOT",
    vantage: "in-view",
    caveat: `Backed by csp-allow-declared as the positive control: the declared origin works, so blocking this one is genuinely the CSP, not a blanket fetch failure.`,
  },
);
