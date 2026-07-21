/**
 * The conformance runner View (React, via ext-apps' `useApp`).
 *
 * Tests run behind a **user-gesture button** rather than auto-running on
 * connect: some hosts (e.g. ChatGPT) only allow display-mode / fullscreen
 * changes under transient user activation, so a click is required for those
 * tests to behave. `useApp`'s `onAppCreated` lets us capture host→view
 * notifications (tool-input/tool-result) BEFORE connect.
 */
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useDriveListener, useStateBroadcast } from "./automation";
import {
	captureHostSignals,
	getRegistry,
	type HostSignals,
	type InteractionRequest,
	runAll,
	type SubtestResult,
} from "./testharness";
import { ensureAppToolRegistered } from "./tests";
import "./style.css";

type Row = Pick<
	SubtestResult,
	| "id"
	| "name"
	| "status"
	| "clause"
	| "vantage"
	| "manual"
	| "caveat"
	| "message"
	| "value"
>;

const freshRows = (): Row[] =>
	getRegistry().map((d) => ({
		id: d.id,
		name: d.name,
		status: "NOTRUN",
		clause: d.clause,
		vantage: d.vantage,
		manual: d.manual,
		caveat: d.caveat,
	}));

const statusClass = (s: string) => `st st-${s.toLowerCase()}`;
const toRow = (r: SubtestResult): Row => ({
	id: r.id,
	name: r.name,
	status: r.status,
	clause: r.clause,
	vantage: r.vantage,
	manual: r.manual,
	caveat: r.caveat,
	message: r.message,
	value: r.value,
});

/** A pending interaction request plus the resolver that settles the test. */
type PendingInteraction = {
	req: InteractionRequest;
	resolve: (v: boolean) => void;
};

/** Syntax-highlight a value as pretty JSON (keys/strings/numbers/bools/null). */
function highlightJson(value: unknown): string {
	const json = JSON.stringify(value, null, 2) ?? "undefined";
	const esc = json
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	return esc.replace(
		/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
		(m) => {
			let cls = "j-num";
			if (/^"/.test(m)) cls = /:$/.test(m) ? "j-key" : "j-str";
			else if (m === "true" || m === "false") cls = "j-bool";
			else if (m === "null") cls = "j-null";
			return `<span class="${cls}">${m}</span>`;
		},
	);
}

/** One collapsible panel showing a captured value as highlighted JSON. */
function JsonPanel({
	label,
	value,
	open,
}: {
	label: string;
	value: unknown;
	open?: boolean;
}) {
	const present = value !== undefined && value !== null;
	return (
		<details className="json-panel" open={open && present}>
			<summary>
				{label}
				{!present && <span className="json-empty">— not provided</span>}
			</summary>
			{present && (
				<pre
					className="json"
					dangerouslySetInnerHTML={{ __html: highlightJson(value) }}
				/>
			)}
		</details>
	);
}

function ConformanceRunner() {
	const signalsRef = useRef<HostSignals | null>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [rows, setRows] = useState<Row[]>(freshRows);
	const [runningId, setRunningId] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [ran, setRan] = useState(false);
	const [interaction, setInteraction] = useState<PendingInteraction | null>(
		null,
	);
	const [inspect, setInspect] = useState<Record<string, unknown>>({});

	const { app, error } = useApp({
		appInfo: { name: "mcp-apps-conformance-runner", version: "0.1.0" },
		// `tools` is required to register app-provided tools (app-tools/call);
		// without it registerTool throws "Client does not support tool capability".
		capabilities: {
			availableDisplayModes: ["inline", "fullscreen"],
			tools: { listChanged: true },
		},
		autoResize: true,
		onAppCreated: (created) => {
			// captureHostSignals wires tool-input/result promises the lifecycle tests
			// await; we no longer surface those in the UI.
			signalsRef.current = captureHostSignals(created);
			created.onerror = (e) => console.error("[conformance] app error:", e);
		},
	});

	// Keep the Inspector in sync with host capabilities/context (context refreshes
	// when the host emits host-context-changed, e.g. a theme toggle).
	useEffect(() => {
		if (!app) return;
		// Register the app-provided tool up front so the host has it for the whole
		// session (mid-run registration in the last test was missed by the host).
		try {
			ensureAppToolRegistered(app);
		} catch (e) {
			console.error("[conformance] registerTool failed:", e);
		}
		const sync = () =>
			setInspect((p) => ({
				...p,
				hostCapabilities: app.getHostCapabilities(),
				hostContext: app.getHostContext(),
			}));
		sync();
		app.addEventListener("hostcontextchanged", sync);
		return () => app.removeEventListener("hostcontextchanged", sync);
	}, [app]);

	// Core runner. `filter` selects which tests run; `reset` clears rows first
	// (a full/auto run) vs. leaving them (a single-test run); `fullscreen` enters
	// fullscreen for the manual finale (human "Run all" only — the hybrid driver
	// runs manual tests one-by-one inline). Rows update via onResult (a merge), so
	// a single-test run never wipes the others.
	const runTests = useCallback(
		async (
			filter: ((d: { id: string; manual: boolean }) => boolean) | undefined,
			opts: { reset: boolean; fullscreen: boolean },
		) => {
			if (!app) return;
			if (opts.reset) {
				setRan(false);
				setRows(freshRows());
			}
			setRunning(true);
			if (opts.reset) {
				// Automatic tests run inline (resize/dimension checks need flexible
				// inline mode); reset to inline in case a prior run left us fullscreen.
				try {
					await app.requestDisplayMode({ mode: "inline" });
				} catch {
					/* host may decline */
				}
			}
			await runAll(
				app,
				signalsRef.current!,
				{
					onStart: (id) => setRunningId(id),
					onResult: (r) =>
						setRows((prev) =>
							prev.map((row) => (row.id === r.id ? toRow(r) : row)),
						),
					onEnterManual: opts.fullscreen
						? async () => {
								try {
									await app.requestDisplayMode({ mode: "fullscreen" });
								} catch {
									/* host may decline */
								}
							}
						: undefined,
					requestInteraction: (req) =>
						new Promise<boolean>((resolve) => {
							const settle = (v: boolean) => {
								setInteraction(null);
								resolve(v);
							};
							// "await" mode: pass automatically the moment the test's signal
							// settles (e.g. the host-context-changed notification arrives).
							if (req.kind === "await" && req.signal) {
								req.signal.then(
									() => settle(true),
									() => settle(false),
								);
							}
							setInteraction({ req, resolve: settle });
						}),
				},
				filter,
			);
			setRunningId(null);
			setInteraction(null);
			setRunning(false);
			setRan(true);
		},
		[app],
	);

	// Human "Run all": full run, inline throughout (each test resets to inline,
	// so a fullscreen finale would only apply to the first manual test anyway).
	const run = useCallback(
		() => runTests(undefined, { reset: true, fullscreen: false }),
		[runTests],
	);

	const runTrigger = useCallback((req: InteractionRequest) => {
		void Promise.resolve(req.trigger?.run()).catch((e) =>
			console.error("[conformance] trigger error:", e),
		);
	}, []);

	const host = app?.getHostVersion();
	const pass = rows.filter((r) => r.status === "PASS").length;
	const failed = rows.filter(
		(r) => r.status === "FAIL" || r.status === "TIMEOUT",
	).length;
	const done = rows.filter((r) => r.status !== "NOTRUN").length;
	const summaryText = `${pass}/${rows.length} passing`;

	// Group tests by their area prefix (security/, display/, …) for the sidebar.
	const groups: { name: string; tests: Row[] }[] = [];
	const gmap = new Map<string, { name: string; tests: Row[] }>();
	for (const r of rows) {
		const name = r.id.split("/")[0];
		let g = gmap.get(name);
		if (!g) {
			g = { name, tests: [] };
			gmap.set(name, g);
			groups.push(g);
		}
		g.tests.push(r);
	}
	const currentRow = runningId ? rows.find((r) => r.id === runningId) : undefined;

	const hostLabel = error
		? "error"
		: app
			? `${host?.name ?? "unknown"}${host?.version ? ` v${host.version}` : ""}`
			: "connecting…";

	// ── external-driver remote control (see automation.ts) ──────────────────────
	// Broadcast a machine-readable snapshot so a Playwright driver can read results
	// and know when a manual test is waiting, without scraping the DOM.
	useStateBroadcast(() => ({
		host: hostLabel,
		connected: !!app,
		running,
		ran,
		runningId,
		total: rows.length,
		done,
		counts: rows.reduce<Record<string, number>>((a, r) => {
			a[r.status] = (a[r.status] ?? 0) + 1;
			return a;
		}, {}),
		summary: summaryText,
		rows: rows.map((r) => ({
			id: r.id,
			status: r.status,
			clause: r.clause,
			vantage: r.vantage,
			manual: r.manual,
			message: r.message,
			value: r.value,
		})),
		interaction: interaction
			? {
					prompt: interaction.req.prompt,
					kind: interaction.req.kind,
					trigger: interaction.req.trigger?.label ?? null,
				}
			: null,
	}));

	// Drive non-gesture steps over postMessage. Gesture-gated triggers (open-link,
	// download, message, sampling) must be REAL clicks — the driver clicks the
	// trigger button directly; "trigger" here is only a same-origin fallback.
	useDriveListener((action, id) => {
		if (action === "run") {
			if (!running) void run();
		} else if (action === "run-auto") {
			if (!running) void runTests((d) => !d.manual, { reset: true, fullscreen: false });
		} else if (action === "run-test") {
			if (!running && id)
				void runTests((d) => d.id === id, { reset: false, fullscreen: false });
		} else if (action === "trigger") {
			if (interaction?.req.trigger) runTrigger(interaction.req);
		} else if (action === "yes") {
			interaction?.resolve(true);
		} else if (action === "no" || action === "skip") {
			interaction?.resolve(false);
		}
	});

	return (
		<main className="wrap">
			<header className="head">
				<div>
					<h1>MCP Apps Conformance</h1>
					<p className="sub">
						Host under test: <span className="mono">{hostLabel}</span>
					</p>
				</div>
				<div className="head-actions">
					{ran && !running && (
						<span className={failed === 0 ? "summary ok" : "summary bad"}>
							{summaryText}
						</span>
					)}
					<button
						type="button"
						className="reset-btn"
						data-testid="host-values"
						title="Show the capabilities and context the host provided"
						onClick={() => dialogRef.current?.showModal()}
						disabled={!app}
					>
						Host values
					</button>
					<button
						type="button"
						className="reset-btn"
						data-testid="reset-inline"
						title="Revert the display mode to inline. Needs a real click on hosts (e.g. ChatGPT) that gate display-mode changes on a user gesture."
						onClick={() => {
							void app?.requestDisplayMode({ mode: "inline" }).catch(() => {});
						}}
						disabled={!app}
					>
						Reset to inline
					</button>
					<button
						type="button"
						className="run-btn"
						data-testid="run"
						onClick={run}
						disabled={!app || running}
					>
						{running
							? `Running ${done}/${rows.length}…`
							: ran
								? "Re-run tests"
								: "Run conformance tests"}
					</button>
				</div>
			</header>

			{running && (
				<div
					className="progress"
					role="progressbar"
					aria-valuenow={done}
					aria-valuemax={rows.length}
				>
					<div
						className="progress-bar"
						style={{
							width: `${rows.length ? (done / rows.length) * 100 : 0}%`,
						}}
					/>
				</div>
			)}

			{error && <p className="msg">connection error: {error.message}</p>}

			<div className="layout">
				<aside className="sidebar">
					{groups.map((g) => {
						const gp = g.tests.filter((t) => t.status === "PASS").length;
						const gf = g.tests.filter(
							(t) => t.status === "FAIL" || t.status === "TIMEOUT",
						).length;
						return (
							<details className="group" key={g.name}>
								<summary>
									<span className="group-name">{g.name}</span>
									<span className={`group-count${gf ? " has-fail" : ""}`}>
										{gp}/{g.tests.length}
									</span>
								</summary>
								<ul className="group-tests">
									{g.tests.map((t) => (
										<li
											key={t.id}
											className={t.id === runningId ? "running" : undefined}
										>
											<span
												className={`dot ${t.id === runningId ? "dot-running" : `dot-${t.status.toLowerCase()}`}`}
											/>
											<span className="tname mono">
												{t.id.slice(g.name.length + 1)}
											</span>
											<span className={statusClass(t.status)}>
												{t.id === runningId ? "…" : t.status}
											</span>
										</li>
									))}
								</ul>
							</details>
						);
					})}
				</aside>

				<section className="current">
					{interaction ? (
						<div className="current-card">
							<div className="current-id mono">
								{currentRow?.id ?? runningId}
							</div>
							<div className="current-meta">
								{currentRow?.clause}
								{currentRow?.vantage ? ` · ${currentRow.vantage}` : ""}
								{currentRow?.manual ? " · manual" : ""}
							</div>
							<span className="interaction-tag">action needed</span>
							<p className="interaction-prompt">{interaction.req.prompt}</p>
							<div className="interaction-actions">
								{interaction.req.trigger && (
									<button
										type="button"
										className="trigger-btn"
										data-testid="trigger"
										onClick={() => runTrigger(interaction.req)}
									>
										{interaction.req.trigger.label}
									</button>
								)}
								{interaction.req.kind === "await" ? (
									<>
										<span className="awaiting">
											<span className="spinner" /> detecting…
										</span>
										<button
											type="button"
											className="verdict-btn no"
											data-testid="verdict-skip"
											onClick={() => interaction.resolve(false)}
										>
											Skip
										</button>
									</>
								) : (
									<>
										<button
											type="button"
											className="verdict-btn ok"
											data-testid="verdict-yes"
											onClick={() => interaction.resolve(true)}
										>
											✅ It worked
										</button>
										<button
											type="button"
											className="verdict-btn no"
											data-testid="verdict-no"
											onClick={() => interaction.resolve(false)}
										>
											❌ It didn’t
										</button>
									</>
								)}
							</div>
						</div>
					) : currentRow ? (
						<div className="current-card">
							<div className="current-id mono">{currentRow.id}</div>
							<div className="current-meta">
								{currentRow.clause}
								{currentRow.vantage ? ` · ${currentRow.vantage}` : ""}
								{currentRow.manual ? " · manual" : ""}
							</div>
							<div className="current-status">
								<span className="spinner" /> running…
							</div>
							{currentRow.message && <p className="msg">{currentRow.message}</p>}
						</div>
					) : (
						<div className="current-card idle">
							{ran ? (
								<>
									<div
										className={`big-summary ${failed === 0 ? "ok" : "bad"}`}
									>
										{summaryText}
									</div>
									<p>Run complete. Toggle a group on the left to review each test.</p>
								</>
							) : (
								<p>
									Click <strong>Run conformance tests</strong> to start. Tests run
									one at a time — the current test shows here, and results fill in
									the groups on the left.
								</p>
							)}
						</div>
					)}
				</section>
			</div>

			<dialog ref={dialogRef} className="values-dialog">
				<div className="values-head">
					<h2>Values provided by the host</h2>
					<button
						type="button"
						className="dialog-close"
						onClick={() => dialogRef.current?.close()}
					>
						×
					</button>
				</div>
				<JsonPanel label="Host capabilities" value={inspect.hostCapabilities} />
				<JsonPanel label="Host context" value={inspect.hostContext} />
			</dialog>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(<ConformanceRunner />);
