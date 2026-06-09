# Host conformance catalogue

Every normative requirement the [MCP Apps spec (`2026-01-26`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
places on a **host** (the Sandbox proxy is host-side, so its requirements are
included). App/View- and server-directed requirements are intentionally excluded —
this suite certifies **hosts**, so every test is a host test. IDs carry no actor
prefix and are namespaced by the spec **capability area** (WPT-path style).

- **Status:** `✅` implemented · `⬜` planned (id reserved, test not yet written).
- **Clause:** the RFC-2119 keyword the spec uses (`MUST` / `MUST NOT` / `SHOULD` / `SHOULD NOT` / `MAY` / `REQUIRED`).
- **Vantage** — where the requirement can actually be observed:
  - `in-view` — from inside the iframe (this runner)
  - `server` — only the test server sees it
  - `agent` — needs the model's view / a multi-turn conversation
  - `transport` — sandbox-internal, not forwarded to the view
  - `manual` — host-internal / UX side effect, not auto-measurable
- ⚠️ flags a measurement caveat — see [How to run against your host → Read the results](../how-to/run-against-your-host.md#4-read-the-results) and [the conformance model](../explanation/conformance-model.md).

> **13 of ~35 host requirements implemented** (all `in-view`). The `⬜` rows have
> reserved IDs; tests fill in against this same catalogue. Many requirements are
> **not** `in-view` — those await a later server-side / agent-driven harness (see
> [what's deferred](../explanation/conformance-model.md#whats-deferred-beyond-the-poc)).

## `security/` — sandboxing & CSP  ·  §Sandbox proxy, §Host Behavior, §Security Considerations

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `security/iframe-sandboxed` | All View content is rendered in sandboxed iframes with restricted permissions. ⚠️ inferred behaviourally, not by reading the sandbox attr | MUST | in-view | ⬜ |
| `security/sandbox-proxy-required` | A web-page host wraps the View behind an intermediate Sandbox proxy. ⚠️ inferred (parent is cross-origin) | MUST | in-view | ⬜ |
| `security/sandbox-distinct-origin` | Host and Sandbox have different origins — reading `window.parent.location` throws | MUST | in-view | ✅ |
| `security/sandbox-permissions` | Sandbox iframe uses exactly `allow-scripts allow-same-origin`. ⚠️ inferred: scripts run + `window.origin` not opaque | MUST | in-view | ✅ |
| `security/sandbox-proxy-ready` | Sandbox emits `ui/notifications/sandbox-proxy-ready` when ready. ⚠️ sandbox-internal, not forwarded to the view | MUST | transport | ⬜ |
| `security/sandbox-resource-ready` | Host sends raw HTML via `ui/notifications/sandbox-resource-ready` once the sandbox is ready. ⚠️ sandbox-internal | MUST | transport | ⬜ |
| `security/sandbox-csp-enforced` | Sandbox loads HTML with CSP enforcing declared domains, `frame-src`, `base-uri`, `object-src 'none'`, restrictive defaults | MUST | in-view | ⬜ |
| `security/sandbox-message-forwarding` | Sandbox forwards Host↔View messages for any non-`ui/notifications/sandbox-` method. ⚠️ only transitively (if broken, nothing works) | MUST | in-view | ⬜ |
| `security/sandbox-no-self-requests` | Sandbox does not originate its own requests. ⚠️ not observable from the view | SHOULD NOT | transport | ⬜ |
| `security/csp-construct-from-domains` | Host constructs CSP headers from the declared domains (verified via fetch allow/deny) | MUST | in-view | ⬜ |
| `security/csp-default-deny` | With **no** `ui.csp`, host applies the restrictive default (`connect-src 'none'`, …). ⚠️ needs a dedicated **no-CSP** resource — the current runner declares a CSP, so this "omitted" path isn't exercised | MUST | in-view | ⬜ |
| `security/csp-allow-declared` | A declared `connectDomains` origin is permitted (positive control). The runner declares `connectDomains: ["https://modelcontextprotocol.io"]`. ⚠️ a network failure also reads as "not allowed", so the origin must be reachable | MUST | in-view | ✅ |
| `security/csp-no-loosening` | Even with a CSP declared, an **undeclared** origin stays blocked. Backed by `csp-allow-declared` as the positive control, so the block is genuinely the CSP | MUST NOT | in-view | ✅ |
| `security/permissions-allow-attr` | Sandbox sets the inner iframe `allow` attribute from declared permissions (feature detection) | MAY | in-view | ⬜ |
| `security/csp-audit-log` | Host logs CSP configurations for security review. ⚠️ host-internal, not auto-measurable | SHOULD | manual | ⬜ |
| `security/external-domain-warning` | Host warns users when a UI requires external domain access. ⚠️ UX side effect | SHOULD | manual | ⬜ |
| `security/global-allowlist` | Host applies global domain allow/block lists. ⚠️ host-internal | MAY | manual | ⬜ |

## `lifecycle/` — handshake & tool notifications  ·  §Lifecycle, §Data Passing

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `lifecycle/initialize-capabilities` | Host responds to `ui/initialize` with `hostCapabilities` in `McpUiInitializeResult` | MUST | in-view | ✅ |
| `lifecycle/tool-input` | Host sends `ui/notifications/tool-input` with complete arguments after the View's initialize completes (via `ontoolinput`) | MUST | in-view | ✅ |
| `lifecycle/tool-input-partial` | Host may stream `ui/notifications/tool-input-partial` zero+ times before `tool-input`. ⚠️ needs the agent to stream args | MAY | agent | ⬜ |
| `lifecycle/tool-input-partial-stop` | Host stops sending partials once `tool-input` is sent. ⚠️ needs streaming args | MUST | agent | ⬜ |
| `lifecycle/tool-result` | Host sends `ui/notifications/tool-result` when execution completes (if the View is displayed; via `ontoolresult`) | MUST | in-view | ✅ |
| `lifecycle/tool-cancelled` | Host sends `ui/notifications/tool-cancelled` if execution is cancelled. ⚠️ needs a cancellation trigger | MUST | agent | ⬜ |
| `lifecycle/teardown-notify` | Host sends a teardown notification before tearing down the View. ⚠️ needs a teardown trigger | MUST | agent | ⬜ |
| `lifecycle/teardown-await` | Host waits for a response before tearing down (to prevent data loss). ⚠️ needs a teardown trigger | SHOULD | agent | ⬜ |

## `tools/` & `visibility/` — proxying & tool exposure  ·  §Resource Discovery, §Visibility

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `tools/proxy-call` | Host proxies `tools/call` from the View to the server and returns the result (when advertising `serverTools`). Also corroborated server-side | MUST | in-view | ✅ |
| `visibility/app-tool-hidden` | Host excludes tools lacking `"model"` visibility from the agent's `tools/list`. ⚠️ needs the agent's tool list — not visible to the view | MUST NOT | agent | ⬜ |
| `visibility/app-tool-call-guard` | Host rejects `tools/call` from apps for tools that don't include `"app"` visibility | MUST | in-view | ✅ |

## `resources/` — UI resource fetching  ·  §Resource Discovery

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `resources/read-referenced` | Host fetches the referenced UI resource via `resources/read`. ⚠️ observed by the server, not the view | MUST | server | ⬜ |
| `resources/prefetch` | Host may prefetch/cache UI resource content. ⚠️ server-observed | MAY | server | ⬜ |

## `context/` — host context & change notifications  ·  §Host Context, §Theming

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `context/initialize-hostcontext` | Host includes `hostContext` in `McpUiInitializeResult`. ⚠️ SHOULD — a host may legitimately omit it | SHOULD | in-view | ✅ |
| `context/context-changed` | Host emits `ui/notifications/context-changed` when context fields change. ⚠️ needs a context-change trigger (theme/mode) | MAY | agent | ⬜ |

## `dimensions/` — sizing  ·  §Container Dimensions

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `dimensions/listen-size-changed` | In flexible mode, host listens for `ui/notifications/size-changed` and updates the iframe. ⚠️ can't read the outer iframe size; infer via hostContext echo | MUST | in-view | ⬜ |

## `display/` — display modes  ·  §Display Modes

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `display/no-undeclared-mode` | Host never switches the View to a mode absent from its `availableDisplayModes` | MUST NOT | in-view | ✅ |
| `display/return-resulting-mode` | Host returns the resulting mode in the `ui/request-display-mode` response | MUST | in-view | ✅ |
| `display/unavailable-returns-current` | If the requested mode is unavailable, host returns the current mode | SHOULD | in-view | ✅ |
| `display/decline-undeclared` | Host may decline mode requests for modes the View didn't declare | MAY | in-view | ⬜ |

## `links/`, `messages/`, `model-context/` — View→Host requests  ·  §MCP Apps Specific Messages

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `links/open-external` | Host opens a `ui/open-link` URL in the user's default browser or a new tab. ⚠️ opens an external tab — side effect outside the iframe | SHOULD | manual | ⬜ |
| `messages/add-to-conversation` | Host adds a `ui/message` to the conversation context, preserving the role. ⚠️ effect lands in the conversation | SHOULD | agent | ⬜ |
| `messages/consent` | Host may request user consent for a `ui/message`. ⚠️ UX prompt | MAY | manual | ⬜ |
| `model-context/provide-future-turns` | Host provides `ui/update-model-context` to the model in future turns. ⚠️ multi-turn | SHOULD | agent | ⬜ |
| `model-context/last-wins` | If several updates arrive before the next user message, host sends only the last. ⚠️ multi-turn | SHOULD | agent | ⬜ |
| `model-context/overwrite-defer-dedupe-display` | Host may overwrite / defer / dedupe / display context updates. ⚠️ multi-turn / UX | MAY | agent | ⬜ |

## `capabilities/` — negotiation & forwarding  ·  §Capability Negotiation, §Sandbox proxy

| ID | Requirement | Clause | Vantage | Status |
|----|-------------|--------|---------|--------|
| `capabilities/mimetypes-required` | Host's UI capability declaration includes `mimeTypes`. ⚠️ negotiation, server-observed | REQUIRED | server | ⬜ |
| `capabilities/server-passthrough` | Host may forward View messages to the server for non-`ui/` methods; should ensure the View's MCP connection is spec-compliant (transitively observable) | MAY · SHOULD | in-view | ⬜ |
