# How the conformance model works

This page explains the *why* behind the suite: the model it borrows from, what it
can and can't observe, how far you can trust a result, and what is deliberately
left out of the current POC.

## The web-platform-tests analogy

The design is lifted from [web-platform-tests](https://web-platform-tests.org)
(WPT), the shared suite that keeps browsers interoperable. The mapping is almost
one-to-one:

| WPT | MCP Apps conformance |
|-----|----------------------|
| Browser engine | **Host** (ChatGPT, Claude, Alpic playground, …) |
| Test = an HTML file the browser opens | Test = the `ui://` page the host renders in its iframe |
| `testharness.js` runs assertions in-page | `testharness.ts` runs assertions over the bridge |
| Test server serves the files | The reference conformance **MCP server** |

The key insight: an MCP Apps UI runs **inside the host's sandboxed iframe** and
talks back over a `postMessage` / JSON-RPC bridge — exactly like a WPT test runs
inside the browser and reports results. So the test must run *in the iframe*; that
is the only place the host's real rendering, sandboxing, and bridge behaviour can
be observed.

> **The host is the browser. The `ui://` page is the WPT test. The bridge is `testharness.js`.**

## Two actors — and why this suite tests only hosts

The MCP Apps spec governs two parties:

- a **server** that ships UI resources and tools, and
- a **host** that renders those resources and brokers the bridge.

This suite certifies **hosts**. Server-side conformance (does a server emit a
valid `ui://` resource, correct MIME, well-formed metadata?) is a separate,
mostly-static problem and is intentionally out of scope. Every test here is a host
test, which is why test IDs carry no actor prefix — they're named by spec
**capability area** instead (`security/`, `lifecycle/`, `display/`, …).

## The vantage model

Not every requirement can be observed from the same place. Each test is tagged
with a **vantage**:

- **`in-view`** — measurable from inside the iframe (this runner). All 12
  implemented tests are here.
- **`server`** — only the test server sees it (e.g. that the host performed
  `resources/read`).
- **`agent`** — needs the model's view or a multi-turn conversation (e.g. that an
  app-only tool is hidden from the agent's tool list).
- **`transport`** — sandbox-internal protocol, not forwarded to the view.
- **`manual`** — a host-internal decision or UX side effect that isn't
  auto-measurable (e.g. logging CSP config, warning the user).

The vantage isn't bureaucracy — it's the honest boundary of what an in-iframe
runner can prove. The [catalogue](../reference/catalogue.md) shows the vantage for
every requirement; the many non-`in-view` rows are what motivates the future work
below.

## How far to trust a result

Two things bound trust.

**Measurement caveats (⚠️).** Some in-view checks can't isolate *why* a thing
happened. `security/csp-default-deny` passes when a cross-origin `fetch` is
blocked — but a CORS or network failure is indistinguishable from a real CSP
block. `visibility/app-tool-call-guard` passes when the app's call to a model-only
tool is rejected — but "tool not found" looks the same as a true visibility
rejection. These are flagged so a green is read with the right scepticism.

**The trust model is cooperative, not adversarial.** The host owns the entire
JavaScript runtime the iframe executes in. It could, in principle, stub `fetch`,
fake a capability, or rewrite a result — so no in-iframe mechanism can *force* a
host to report honestly. This is the same trust model as WPT: a browser runs the
tests on itself and reports its own pass/fail. The goal is to surface real interop
bugs in good-faith implementations, not to defend against a host that wants to
cheat (which would only be cheating itself).

## Why a "Run tests" button

Tests run behind a button rather than auto-running on connect because some hosts
(e.g. ChatGPT) only permit display-mode and fullscreen changes under a real user
gesture (transient activation). The click provides that activation. One known
limitation: activation expires partway through an async run, so display-mode tests
that execute late can still be refused on strict hosts — a future refinement runs
gesture-gated tests first.

## What's deferred (beyond the POC)

The current scope is the **runner only**: a single `ui://` page that renders in a
host, asserts the in-view requirements, and shows `PASS`/`FAIL` *in the iframe*.
Results are not persisted or aggregated. The following are intentionally left for
later:

- **Results collection** — a sink (server-side or dedicated) that records each
  host's results.
- **A host-by-host comparison grid** — the interop scoreboard, the part of WPT
  (`wpt.fyi`) that turns conformance into a visible, comparable signal.
- **Server-side judging** — having the view emit *raw observations* and the server
  apply the assertions, so verdicts are deterministic, auditable, and not editable
  by the host on the way back.
- **An agent-driven harness** — to reach the `agent`-vantage requirements
  (tool-list visibility, multi-turn model context, streaming tool input) that an
  in-iframe runner cannot see.

See the [catalogue](../reference/catalogue.md) for the full requirement list and
which vantage each one needs.
