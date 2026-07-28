#!/usr/bin/env tsx
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Clause, Status } from "../../shared/protocol";
import type { ResultsFile } from "./results";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "runner", "out");
const CATALOGUE = join(ROOT, "catalogue.json");

const SPEC_URL: Record<string, string> = {
  "2026-01-26":
    "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx?plain=1",
  draft:
    "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx?plain=1",
};
const CLAUSE_ORDER: Clause[] = ["MUST", "MUST NOT", "REQUIRED", "SHOULD", "SHOULD NOT", "MAY"];
const HOST_LABEL: Record<string, string> = { playground: "alpic-playground" };
const STATUS_CLASS: Record<string, string> = {
  PASS: "pass",
  FAIL: "fail",
  TIMEOUT: "fail",
  SKIP: "skip",
  NOTRUN: "notrun",
  "": "notrun",
};

interface CatalogueEntry {
  id: string;
  clause: Clause;
  vantage?: string;
  spec: string;
  line: number;
  implemented?: boolean;
  bucket?: string;
  askAgent?: boolean;
}

type LoadedResults = ResultsFile & { _file: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function latestResult(hostDir: string): LoadedResults | null {
  const files = readdirSync(hostDir)
    .filter((f) => f.startsWith("results-") && f.endsWith(".json"))
    .sort();
  if (files.length === 0) return null;
  const file = files[files.length - 1];
  // Tolerate the legacy Python driver's `rows` key (pre-TS-migration artifacts)
  // alongside the new `results` key so the matrix stays populated until a re-run.
  const d = JSON.parse(readFileSync(join(hostDir, file), "utf8")) as ResultsFile & {
    rows?: ResultsFile["results"];
  };
  return { ...d, results: d.results ?? d.rows ?? [], _file: file };
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

function localStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function specLink(e: CatalogueEntry): string {
  const base = SPEC_URL[e.spec];
  const label = `${e.spec} · L${e.line}`;
  if (!base) return esc(label);
  return `<a href="${base}#L${e.line}" target="_blank" rel="noopener">${esc(label)}</a>`;
}

function main(): number {
  const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8")) as CatalogueEntry[];
  const results: Record<string, LoadedResults> = {};
  if (existsSync(OUT)) {
    for (const name of readdirSync(OUT).sort()) {
      const hd = join(OUT, name);
      const r = latestResult(hd);
      if (r) results[name] = r;
    }
  }
  const hosts = Object.keys(results);
  const byHostRow: Record<string, Record<string, ResultsFile["results"][number]>> = {};
  for (const h of hosts) {
    byHostRow[h] = {};
    for (const row of results[h].results ?? []) byHostRow[h][row.id] = row;
  }
  const values: Record<string, string> = {};

  const cell = (host: string, rid: string): string => {
    const row = byHostRow[host][rid];
    if (!row) return '<td class="st notrun">·</td>';
    const status = (row.status ?? "").toString().trim();
    const cls = STATUS_CLASS[status] ?? "skip";
    const parts = [row.message, row.caveat].filter((p): p is string => Boolean(p));
    let has = "";
    let tip = "";
    if (parts.length) {
      has = " has-tip";
      tip = `<span class="tip">${parts.map(esc).join("<br>")}</span>`;
    }
    let val = "";
    if (row.value !== undefined && row.value !== null) {
      const key = `${rid}::${host}`;
      values[key] = JSON.stringify(row.value, null, 2);
      val = `<button type="button" class="val-link" onclick="openVal('${key}')" title="Show the value the host provided">ⓥ</button>`;
    }
    return `<td class="st ${cls}${has}">${esc(status || "—")}${val}${tip}</td>`;
  };

  const impl = catalogue.filter((e) => e.implemented);
  const pending = catalogue.filter((e) => !e.implemented);
  const ncol = 1 + hosts.length;

  const hostHeader = (h: string): string => {
    let rec = "";
    if (existsSync(join(ROOT, "docs", "recordings", `${h}.webm`))) {
      rec = `<div class="host-meta"><button type="button" class="rec-link" onclick="openRec('${h}')">▶ recording</button></div>`;
    }
    const info = results[h].hostInfo;
    const implLabel = info
      ? [info.title ?? info.name, info.version].filter(Boolean).join(" ")
      : "";
    const impl = implLabel
      ? `<div class="host-meta" title="MCP client implementation reported by the host">${esc(implLabel)}</div>`
      : "";
    return (
      `<th class="host"><div class="host-name">${esc(HOST_LABEL[h] ?? h)}</div>${impl}` +
      `<div class="host-meta">${esc(fmtTime(results[h].capturedAt))}</div>${rec}</th>`
    );
  };

  const headCells = hosts.map(hostHeader).join("");

  let body = "";
  for (const clause of CLAUSE_ORDER) {
    const rows = impl.filter((e) => e.clause === clause);
    if (!rows.length) continue;
    body += `<tr class="section"><td colspan="${ncol}">${esc(clause)}</td></tr>`;
    for (const e of rows) {
      body +=
        `<tr><td class="id">${esc(e.id)}` +
        `<div class="sub">${esc(e.vantage ?? "")} · ${specLink(e)}</div></td>` +
        hosts.map((h) => cell(h, e.id)).join("") +
        "</tr>";
    }
  }

  let pend = "";
  if (pending.length) {
    pend =
      '<h2>Not yet implemented</h2><table class="pending"><thead><tr><th>Test</th><th>Clause</th><th>Vantage</th><th>Spec</th></tr></thead><tbody>';
    for (const clause of CLAUSE_ORDER) {
      for (const e of pending.filter((x) => x.clause === clause)) {
        pend +=
          `<tr><td class="id">${esc(e.id)}</td>` +
          `<td>${esc(e.clause)}</td><td>${esc(e.vantage ?? "")}</td>` +
          `<td>${specLink(e)}</td></tr>`;
      }
    }
    pend += "</tbody></table>";
  }

  const generated = localStamp();
  const hostlist = hosts.map(esc).join(", ") || "no results yet — run the driver";
  const valuesJs = JSON.stringify(values);
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>MCP Apps Conformance — results</title>
<style>
  :root { --line:#e6e8ec; --muted:#5b6573; --pass:#137333; --pass-bg:#e6f4ea;
           --fail:#c5221f; --fail-bg:#fce8e6; --notrun:#80868b; --notrun-bg:#f1f3f4;
           --skip:#b06000; --skip-bg:#fef7e0; --accent:#1a73e8; }
  * { box-sizing:border-box; }
  body { margin:0 auto; max-width:1040px; padding:32px 28px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#171a1f; }
  h1 { font-size:18px; margin:0 0 2px; }
  h2 { font-size:15px; margin:28px 0 8px; }
  .gen { color:var(--muted); font-size:12px; margin-bottom:6px; }
  .gen a { color:var(--accent); text-decoration:none; } .gen a:hover { text-decoration:underline; }
  .note { color:var(--muted); font-size:11px; margin-bottom:16px; font-style:italic; }
  table { border-collapse:separate; border-spacing:0; font-size:13px; }
  th, td { border-bottom:1px solid var(--line); padding:8px 12px; text-align:left; vertical-align:top; }
  thead th { position:sticky; top:0; background:#fff; z-index:2; }
  td.id, th.corner { position:sticky; left:0; background:#fff; z-index:1; max-width:360px; }
  td.id { font-family:ui-monospace,Menlo,monospace; font-size:12px; }
  .sub { color:var(--muted); font-size:10px; margin-top:2px; }
  .sub a { color:var(--accent); text-decoration:none; } .sub a:hover { text-decoration:underline; }
  th.host { min-width:110px; } .host-name { font-weight:600; }
  .host-meta { color:var(--muted); font-size:10px; font-weight:400; margin-top:2px; }
  .host-meta a { color:var(--accent); text-decoration:none; } .host-meta a:hover { text-decoration:underline; }
  tr.section td { background:#f1f3f4; font-weight:700; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#3c4043; position:sticky; left:0; }
  td.st { font-family:ui-monospace,Menlo,monospace; font-size:11px; font-weight:600; text-align:center; position:relative; }
  .has-tip { cursor:help; }
  .tip { display:none; position:absolute; left:50%; top:calc(100% + 4px); transform:translateX(-50%); z-index:10;
          background:#171a1f; color:#fff; padding:7px 9px; border-radius:6px; font-family:-apple-system,sans-serif;
          font-size:11px; font-weight:400; line-height:1.45; text-align:left; white-space:normal; width:max-content;
          max-width:340px; box-shadow:0 6px 20px rgba(0,0,0,.3); pointer-events:none; }
  .has-tip:hover .tip { display:block; }
  .pass { color:var(--pass); background:var(--pass-bg); }
  .fail { color:var(--fail); background:var(--fail-bg); }
  .notrun { color:var(--notrun); background:var(--notrun-bg); }
  .skip { color:var(--skip); background:var(--skip-bg); }
  .legend { margin:10px 0 16px; display:flex; gap:8px; flex-wrap:wrap; font-size:11px; align-items:center; }
  .legend span { padding:2px 8px; border-radius:6px; }
  table.pending td.id { position:static; } table.pending { color:var(--muted); }
  table.pending a { color:var(--accent); text-decoration:none; } table.pending a:hover { text-decoration:underline; }
  .val-link { border:none; background:transparent; cursor:pointer; color:var(--accent); font-size:11px; margin-left:5px; padding:0; }
  .val-dialog { border:1px solid var(--line); border-radius:12px; padding:18px; max-width:620px; width:90vw; }
  .val-dialog::backdrop { background:rgba(0,0,0,0.4); }
  .val-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
  .val-head h2 { font-size:14px; margin:0; font-family:ui-monospace,Menlo,monospace; }
  .val-close { border:none; background:transparent; font-size:22px; line-height:1; cursor:pointer; color:var(--muted); }
  #val-body { background:#f6f8fa; padding:12px; border-radius:6px; overflow:auto; font-size:11px; font-family:ui-monospace,Menlo,monospace; max-height:62vh; white-space:pre; margin:0; }
  .rec-link { border:none; background:transparent; cursor:pointer; color:var(--accent); font-size:10px; padding:0; } .rec-link:hover { text-decoration:underline; }
  .rec-dialog { border:1px solid var(--line); border-radius:12px; padding:16px; max-width:900px; width:92vw; }
  .rec-dialog::backdrop { background:rgba(0,0,0,0.5); }
  #rec-video { width:100%; border-radius:8px; background:#000; display:block; }
</style></head><body>
<h1>MCP Apps Conformance — results</h1>
<div class="gen">Generated ${generated} · hosts: ${hostlist} · <a href="how-it-works.html">How it works ↗</a> · <a href="architecture.html">Architecture ↗</a></div>
<div class="note">Single run per host, some manual verdicts operator-assisted. Grouped by RFC-2119 clause — a FAIL under SHOULD/MAY means the optional behavior isn't supported, not a spec violation.</div>
<div class="legend"><span class="pass">PASS</span><span class="fail">FAIL / TIMEOUT</span><span class="notrun">not run</span>&nbsp;hover a cell for the message / driver action · click a test's spec link for the exact line</div>
<table><thead><tr><th class="corner">Test</th>${headCells}</tr></thead><tbody>${body}</tbody></table>
${pend}
<dialog id="val-dialog" class="val-dialog">
  <div class="val-head"><h2 id="val-title">value</h2><button type="button" class="val-close" onclick="document.getElementById('val-dialog').close()">×</button></div>
  <pre id="val-body"></pre>
</dialog>
<dialog id="rec-dialog" class="rec-dialog">
  <div class="val-head"><h2 id="rec-title">recording</h2><button type="button" class="val-close" onclick="document.getElementById('rec-dialog').close()">×</button></div>
  <video id="rec-video" controls preload="metadata"></video>
</dialog>
<script>
const VALUES = ${valuesJs};
function openVal(k) {
  document.getElementById('val-title').textContent = k;
  document.getElementById('val-body').textContent = VALUES[k] || '(no value)';
  document.getElementById('val-dialog').showModal();
}
function openRec(h) {
  const v = document.getElementById('rec-video');
  document.getElementById('rec-title').textContent = h + ' — session recording';
  v.src = 'recordings/' + h + '.webm';
  document.getElementById('rec-dialog').showModal();
  v.play().catch(() => {});
}
document.getElementById('rec-dialog').addEventListener('close', () => {
  const v = document.getElementById('rec-video');
  v.pause();
  v.removeAttribute('src');
  v.load();
});
</script>
</body></html>`;

  const outFile = join(ROOT, "docs", "index.html");
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, doc);
  console.log(`Wrote ${outFile}`);
  console.log(
    `Hosts: ${hosts.map((h) => `${h} (${results[h]._file})`).join(", ") || "none"}`,
  );
  console.log(`Implemented: ${impl.length} · pending: ${pending.length}`);
  return 0;
}

main();
