# Conformance for MCP Apps — strategy & open questions

> **Draft for the MCP Apps working group.** Written by the Alpic team from
> building a WPT-style host-conformance runner for SEP-1865
> ([repo](https://github.com/alpic-ai/mcp-app-conformance) · [catalogue](reference/catalogue.md)).
> The goal of this note is to surface the problems we hit so we can solve them
> together — not to prescribe answers.

## TL;DR

We built a [web-platform-tests](https://web-platform-tests.org)-style conformance
runner: one reference MCP server ships a `ui://` test page that renders **inside
the host's sandboxed iframe**, drives the `postMessage`/JSON-RPC bridge, asserts
the host's behaviour against the spec, and reports `PASS`/`FAIL`. We extracted
**45 host requirements** from the `2026-01-26` spec and have **18 implemented**
so far (all of the kind a runner can observe from inside the iframe).

Building it surfaced two structural problems we'd like the group's input on:

1. **Some host requirements emit no signal a test can observe** — they may need
   *trust / attestation* tests rather than automated ones.
2. **We have no agreed answer for where conformance results live** — *where*,
   *who*, and *how*, given results come from multiple producers (the view, the
   server, and sometimes a human).

Plus a few supporting issues (user-activation gating, per-resource CSP, the
cooperative trust model). The throughline: **MCP Apps is only as conformance-
testable as the spec makes its behaviours observable.**

## Framing: the "vantage" of a requirement

The single most useful lens we found is *where* a requirement can be observed.
Every requirement falls into one of three vantages, plus an orthogonal flag:

| Vantage | Observed from | Example | Count |
|---------|---------------|---------|-------|
| `in-view` | inside the iframe (the runner) | host enforces the declared CSP; returns `hostContext` | ~24 |
| `host` | the host's own surface (its DOM, the host↔sandbox channel, the conversation/model) — from *outside* the view | iframe actually carries `sandbox`; app-only tool hidden from the model's tool list | ~18 |
| `server` | the test server (the MCP connection) | host advertises `mimeTypes` in its `initialize` capability | 3 |
| `· manual` (flag) | needs a *human action* to trigger or verify | change the theme, cancel a tool, read the conversation | ~14 |

Only `in-view` is fully automatable by a runner today. Everything else is the
subject of the open questions below.

## Problem 1 — Requirements with no observable signal ("trust tests")

A large class of `MUST`/`SHOULD` requirements leave **no trace the runner (or
anyone) can automatically observe**:

- **Side effects that leave the iframe entirely.** `ui/open-link` opens a tab in
  the user's browser — the view has *no way* to know whether it happened. Same
  for the `ui/message` consent prompt and the "external domain access" warning.
- **The view can't see its own container.** Whether its iframe actually carries
  the `sandbox` attribute, or sits behind a sandbox-proxy frame, is cross-origin
  and unreadable from inside.
- **Conversation / model effects.** Whether an app-only tool is hidden from the
  *model's* tool list, or whether `ui/update-model-context` reaches the model on
  a later turn, lives in the agent — not the view.

For these, an automated assertion is impossible from inside the runner. The
options we see:

1. **Host-DOM / instrumentation harness** — drive the host page with browser
   automation and inspect its DOM and message channel. Works for the structural
   ones (sandbox attribute, proxy frame), but is host-specific and brittle, and
   still can't see "did a browser tab open."
2. **Human-verified ("manual") tests** — a checklist a person runs. Honest, but
   doesn't scale and isn't an interop *signal*.
3. **Self-attestation / a conformance hook in the spec** — the host *reports*
   that it did the thing (e.g. an opt-in conformance/debug mode in which the host
   echoes "I opened the link", "I hid tool X from the model", "I sandboxed the
   iframe"). This makes the invisible observable — at the cost of trusting the
   host's report.

> **Question for the WG:** For requirements with no in-band signal, do we accept
> *trust tests* (host self-attestation), define an optional **conformance-mode
> observability hook** in the spec, or leave them to per-host manual review? Our
> bias: a small, optional self-report surface would make a big chunk of the spec
> testable.

## Problem 2 — Where do results live? (where / who / how)

Conformance results don't come from one place. In our design they're produced by:

- the **view** (in-view tests, reported from the iframe),
- the **server** (server-vantage tests — e.g. the `mimeTypes` capability is only
  visible on the host→server MCP `initialize`),
- and, for Problem-1 requirements, a **host-DOM harness or a human**.

That makes three sub-questions:

- **WHERE** do results live? A shared, neutral store (a `wpt.fyi`-style interop
  dashboard)? Per-host self-published? In each test server?
- **WHO** runs the suite and submits results — the host vendor (self-report, see
  the trust issue), or a neutral runner?
- **HOW** are multi-producer results merged and trusted?
  - **Correlation.** Tying a server observation (seen at `initialize`) to the
    view's run needs a shared key. A **session id** is the clean answer — but in
    practice tunnels/relays sometimes strip `Mcp-Session-Id`, forcing a fuzzy key
    (client name/version) or a two-phase merge.
  - **Integrity.** The host is *on the data path* between the runner and any sink
    and could rewrite its own results. This is the same cooperative trust model
    as WPT (a browser runs the tests on itself), but it's worth being explicit
    that the suite catches *bugs*, not *bad faith*. A partial mitigation: have the
    view emit **raw observations** and let a neutral collector apply the
    assertions (deterministic, auditable) — but it doesn't defend against a host
    that fakes the observations.

> **Question for the WG:** Is a shared interop dashboard a goal for MCP Apps? If
> so, what's the result schema, the submission/trust model, and the correlation
> key across the view + server + manual producers?

## Supporting issues

- **User-activation gating.** Some hosts (e.g. ChatGPT) only allow display-mode /
  fullscreen changes under a user gesture (transient activation). A single "Run"
  button's activation expires partway through an async run, so gesture-gated tests
  can be refused mid-run. *WG question:* should conformance runs (or declared
  display modes) get relaxed activation, or should the suite gesture each test?
- **CSP is per-resource.** "Omitted CSP → restrictive default" and "declared
  `connectDomains` allowed" can't be tested on the same `ui://` resource — they
  need separate resources. Minor, but it shapes test layout.
- **Two `initialize`s.** `mimeTypes` rides the host→server MCP `initialize`
  (server-observable), while the view's `ui/initialize` returns a *different*
  `hostCapabilities` (no `mimeTypes`). Easy to conflate; worth a spec note.

## What we're proposing

- Keep the **vantage model** as shared vocabulary — it cleanly predicts what's
  automatable, what needs host instrumentation, and what needs a human.
- Treat **`in-view`** as the automatable core (where we're focused), and use the
  catalogue to make the **`host` / `server` / `manual`** gaps explicit rather than
  pretending they're covered.
- Bring Problems 1 & 2 to the group: an **optional conformance-observability
  surface** in the spec would convert many trust tests into real signals, and a
  **shared result model** would turn per-host runs into an interop scoreboard.

Feedback, disagreement, and "you're testing the wrong thing" all welcome — open an
issue on the repo or reply in the working group.
