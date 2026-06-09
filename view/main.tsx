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
import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  runAll,
  getRegistry,
  captureHostSignals,
  type HostSignals,
  type SubtestResult,
} from "./testharness";
import "./tests";
import "./style.css";

type Row = Pick<SubtestResult, "id" | "name" | "status" | "clause" | "vantage" | "caveat" | "message">;

const INITIAL_ROWS: Row[] = getRegistry().map((d) => ({
  id: d.id,
  name: d.name,
  status: "NOTRUN",
  clause: d.clause,
  vantage: d.vantage,
  caveat: d.caveat,
}));

const statusClass = (s: string) => `st st-${s.toLowerCase()}`;

function ConformanceRunner() {
  const signalsRef = useRef<HostSignals | null>(null);
  const [rows, setRows] = useState<Row[]>(INITIAL_ROWS);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);

  const { app, error } = useApp({
    appInfo: { name: "mcp-apps-conformance-runner", version: "0.1.0" },
    capabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    autoResize: true,
    onAppCreated: (created) => {
      signalsRef.current = captureHostSignals(created);
      created.onerror = (e) => console.error("[conformance] app error:", e);
    },
  });

  // POC scope: results are rendered in the iframe only — not reported anywhere.
  const run = useCallback(async () => {
    if (!app) return;
    setRunning(true);
    const results = await runAll(app, signalsRef.current ?? undefined);
    setRows(results);
    setRunning(false);
    setRan(true);
  }, [app]);

  const host = app?.getHostVersion();
  const pass = rows.filter((r) => r.status === "PASS").length;
  const hostLabel = error ? "error" : app ? `${host?.name ?? "unknown"}${host?.version ? ` v${host.version}` : ""}` : "connecting…";

  return (
    <main className="wrap">
      <header className="head">
        <div>
          <h1>MCP Apps Conformance</h1>
          <p className="sub">Host under test: <span className="mono">{hostLabel}</span></p>
        </div>
        <div className="head-actions">
          {ran && (
            <span className={pass === rows.length ? "summary ok" : "summary bad"}>{pass}/{rows.length} passing</span>
          )}
          <button className="run-btn" onClick={run} disabled={!app || running}>
            {running ? "Running…" : ran ? "Re-run tests" : "Run conformance tests"}
          </button>
        </div>
      </header>

      {error && <p className="msg">connection error: {error.message}</p>}

      <table className="grid">
        <thead>
          <tr><th>ID</th><th>Test</th><th>Clause</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id}</td>
              <td>
                {r.name}
                {r.message && <div className="msg">{r.message}</div>}
                {r.caveat && <div className="caveat">⚠️ {r.caveat}</div>}
              </td>
              <td className="mono">
                {r.clause}
                {r.vantage && <span className="vantage">{r.vantage}</span>}
              </td>
              <td><span className={statusClass(r.status)}>{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ConformanceRunner />);
