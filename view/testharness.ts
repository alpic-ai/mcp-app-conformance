/**
 * mcp-app-testharness — the WPT-style assertion harness for MCP Apps.
 *
 * Each `mcp_test(...)` registers a subtest. `runAll(app)` runs them inside the
 * host's sandboxed iframe (the App is already connected) and returns a
 * WPT-shaped result array. This is the analog of testharness.js, except the
 * "browser" is the MCP host and assertions drive the postMessage/JSON-RPC
 * bridge exposed by the ext-apps `App`.
 */
import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * `INFO` = an optional (`MAY`) behaviour was observed and reported as a
 * capability signal — neither pass nor fail. Use `t.info()` instead of asserting.
 */
export type Status = "PASS" | "FAIL" | "TIMEOUT" | "NOTRUN" | "INFO";
export type Clause = "MUST" | "MUST NOT" | "SHOULD" | "SHOULD NOT" | "MAY" | "REQUIRED";
/** "core" = spec-mandated; "host-specific" = shim/extension behaviour not scored against strict hosts. */
export type Tag = "core" | "host-specific";
/**
 * Where the requirement can actually be observed:
 * - "in-view"   — measurable from inside the iframe (this harness)
 * - "server"    — only the test server sees it (proxied call, resources/read)
 * - "agent"     — needs the model's view / a multi-turn conversation
 * - "transport" — sandbox-internal protocol, not forwarded to the view
 * - "manual"    — host-internal / UX side effect, not auto-measurable
 */
export type Vantage = "in-view" | "server" | "agent" | "transport" | "manual";

export interface SubtestResult {
  id: string;
  name: string;
  status: Status;
  tag: Tag;
  vantage: Vantage;
  clause?: Clause;
  /** Why this result may be unreliable / what it can't distinguish. */
  caveat?: string;
  message?: string;
  durationMs: number;
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * Host→View notifications that fire around connect (before runAll runs), so we
 * capture them as promises BEFORE `app.connect()` and let tests await them.
 * A notification that never arrives makes its test TIMEOUT (the correct
 * conformance signal that the host didn't send it).
 */
export interface HostSignals {
  toolInput: Promise<unknown>;
  toolResult: Promise<unknown>;
  /**
   * `ui/notifications/tool-input-partial` observations. Partials may arrive 0+
   * times BEFORE `tool-input`; the spec forbids any after it. `sawAfterToolInput`
   * flips true if the host violates that.
   */
  partials: { count: number; last: unknown; sawAfterToolInput: boolean };
}

export function captureHostSignals(app: App): HostSignals {
  let resolveInput!: (v: unknown) => void;
  let resolveResult!: (v: unknown) => void;
  let toolInputArrived = false;
  const toolInput = new Promise<unknown>((r) => { resolveInput = r; });
  const toolResult = new Promise<unknown>((r) => { resolveResult = r; });
  const partials = { count: 0, last: undefined as unknown, sawAfterToolInput: false };

  app.ontoolinput = (params) => { toolInputArrived = true; resolveInput(params); };
  app.ontoolinputpartial = (params) => {
    partials.count += 1;
    partials.last = params;
    if (toolInputArrived) partials.sawAfterToolInput = true; // illegal: partial after tool-input
  };
  app.ontoolresult = (result) => resolveResult(result);
  return { toolInput, toolResult, partials };
}

/** Never-resolving signals, used when runAll is called without capture. */
function pendingSignals(): HostSignals {
  return {
    toolInput: new Promise<unknown>(() => {}),
    toolResult: new Promise<unknown>(() => {}),
    partials: { count: 0, last: undefined, sawAfterToolInput: false },
  };
}

export class TestContext {
  constructor(public readonly app: App, public readonly signals: HostSignals) {}

  /**
   * Cleanups run after the test completes — pass OR fail — in reverse order.
   * Register one to restore any host state the test mutated (e.g. display mode)
   * so it can't leak into the next test.
   */
  readonly cleanups: Array<() => void | Promise<void>> = [];
  addCleanup(fn: () => void | Promise<void>): void {
    this.cleanups.push(fn);
  }

  /**
   * Report a capability signal for an optional (`MAY`) behaviour instead of
   * asserting. The result becomes `INFO` (not pass/fail) with this message.
   */
  infoMessage?: string;
  info(message: string): void {
    this.infoMessage = message;
  }

  assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new AssertionError(msg);
  }

  assertEquals<T>(actual: T, expected: T, msg = "assertEquals"): void {
    if (actual !== expected) {
      throw new AssertionError(
        `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }

  /**
   * Returns true if a network request to `url` is blocked — either by the host's
   * Content-Security-Policy (`connect-src`) or by the network layer. Used to
   * prove the host enforces the spec's restrictive CSP default.
   */
  async expectFetchBlocked(url: string): Promise<boolean> {
    try {
      await fetch(url, { mode: "no-cors", cache: "no-store" });
      return false; // request was allowed to leave → NOT blocked
    } catch {
      return true; // threw → blocked (CSP violation or network error)
    }
  }

  /**
   * Returns true if a request to `url` is allowed out (CSP permits it). The
   * positive control for declared `connectDomains`. ⚠️ a network error also
   * reads as "not allowed", so point this at a reliably reachable origin.
   */
  async expectFetchAllowed(url: string): Promise<boolean> {
    return !(await this.expectFetchBlocked(url));
  }

  /**
   * Returns true if the host rejects a `tools/call` for `name` (e.g. the
   * visibility guard rejecting an app's call to a model-only tool).
   */
  async expectToolRejected(name: string, args: Record<string, unknown> = {}): Promise<boolean> {
    try {
      await this.app.callServerTool({ name, arguments: args });
      return false; // call succeeded → NOT rejected
    } catch {
      return true; // threw → rejected
    }
  }
}

interface TestDef {
  id: string;
  name: string;
  tag: Tag;
  vantage: Vantage;
  clause?: Clause;
  caveat?: string;
  timeoutMs: number;
  fn: (t: TestContext) => void | Promise<void>;
}

const registry: TestDef[] = [];

export interface TestOptions {
  tag?: Tag;
  vantage?: Vantage;
  clause?: Clause;
  /** A warning about what this result can't distinguish or where it may mislead. */
  caveat?: string;
  timeoutMs?: number;
}

export function mcp_test(
  id: string,
  name: string,
  fn: (t: TestContext) => void | Promise<void>,
  opts: TestOptions = {},
): void {
  registry.push({
    id,
    name,
    fn,
    tag: opts.tag ?? "core",
    vantage: opts.vantage ?? "in-view",
    clause: opts.clause,
    caveat: opts.caveat,
    timeoutMs: opts.timeoutMs ?? 5000,
  });
}

export function getRegistry(): ReadonlyArray<Omit<TestDef, "fn">> {
  return registry;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AssertionError(`timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function runAll(app: App, signals: HostSignals = pendingSignals()): Promise<SubtestResult[]> {
  const results: SubtestResult[] = [];
  for (const def of registry) {
    const t = new TestContext(app, signals); // fresh context per test → isolated cleanups
    const start = performance.now();
    let status: Status = "PASS";
    let message: string | undefined;
    try {
      await withTimeout(Promise.resolve(def.fn(t)), def.timeoutMs);
    } catch (e) {
      const err = e as Error;
      status = err instanceof AssertionError && /timed out/.test(err.message) ? "TIMEOUT" : "FAIL";
      message = err.message;
    } finally {
      // Restore any host state the test mutated (newest cleanup first), so it
      // can't leak into the next test. Cleanup errors never fail the test.
      for (const fn of [...t.cleanups].reverse()) {
        try {
          await fn();
        } catch (e) {
          console.error("[conformance] cleanup error:", e);
        }
      }
    }
    // An optional-behaviour report (t.info) becomes INFO unless the test failed.
    if (status === "PASS" && t.infoMessage !== undefined) {
      status = "INFO";
      message = t.infoMessage;
    }
    results.push({
      id: def.id,
      name: def.name,
      status,
      tag: def.tag,
      vantage: def.vantage,
      clause: def.clause,
      caveat: def.caveat,
      message,
      durationMs: Math.round(performance.now() - start),
    });
  }
  return results;
}
