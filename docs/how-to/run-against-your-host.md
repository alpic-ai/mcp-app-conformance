# Run the conformance suite against your host

This guide shows how to check whether an **MCP host** (ChatGPT, Claude, the Alpic
playground, or your own client) conforms to the MCP Apps spec. You connect the
hosted conformance **MCP server** to the host you want to test, ask the host to
run the suite, and read the results — all inside the host's own UI.

## Before you start

- A host that supports the **MCP Apps** extension (`io.modelcontextprotocol/ui`) —
  i.e. it can render a `ui://` resource in a sandboxed iframe. If the host has no
  MCP Apps support, the launcher tool still runs but no runner UI appears.
- The conformance server URL:

  ```
  https://mcp-apps-conformance.alpic.live/mcp
  ```

## 1. Add the conformance server to your host

Wherever your host lets you add a **custom MCP server / connector**, paste the URL above

- **ChatGPT** — Settings → Connectors / Apps → add a custom MCP server.
- **Claude** — Settings → Connectors → add a custom connector.
- **Alpic playground / other clients** — add the server by URL.

## 2. Run the suite

Send the host a prompt that asks it to call the suite's launcher tool,
`run_conformance`. For example:

> Run the MCP Apps conformance test suite against this host using the
> `run_conformance` tool, then I'll click Run.

The host calls `run_conformance`, which renders the **conformance runner** in a
sandboxed iframe. In the runner, click **Run conformance tests**.

> The tests run behind a button on purpose: some hosts only allow display-mode or
> fullscreen changes under a real user gesture, so a click gives the suite that
> activation.

## 3. Watch it run

The runner connects over the host's `postMessage` / JSON-RPC bridge and executes
the **12 in-view tests** in place. Each row shows its ID, the spec clause, the
vantage, and a live status.

## 4. Read the results

Each test ends in one status:

| Status | Meaning |
|--------|---------|
| **PASS** | The host satisfied the requirement. |
| **FAIL** | The host violated the requirement (or behaved differently than the spec mandates). |
| **TIMEOUT** | An expected host message/notification never arrived in time (treated as not-implemented). |
| **NOTRUN** | The test hasn't executed yet. |

A **FAIL is a real conformance finding**, not a bug in the suite. For example, if
`display/no-undeclared-mode` fails, the host switched the view to a display mode
the app never declared — a `MUST NOT` violation.

**Mind the ⚠️ caveats.** Some in-view checks can't fully isolate *why* something
happened, so read the caveat before trusting a result:

- `security/csp-default-deny` passes if a cross-origin `fetch` is blocked — but a
  CORS or network failure looks the same as a real CSP block.
- `visibility/app-tool-call-guard` passes if the app's call to a model-only tool
  is rejected — but "tool not found" is indistinguishable from a true
  visibility-guard rejection.

See the [Host conformance catalogue](../reference/catalogue.md) for what each test
ID checks, its clause, and its caveat, and [How the conformance model
works](../explanation/conformance-model.md) for why some requirements can't be
measured from inside the iframe at all.

## Troubleshooting

- **The host never calls `run_conformance`.** Confirm the server connected and the
  tool is listed; re-prompt naming the tool explicitly.
- **The tool runs but no UI appears.** The host likely doesn't support MCP Apps
  (rendering `ui://` resources). Conformance testing needs a host that renders the
  iframe.
