#!/usr/bin/env tsx
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Clause } from "../../shared/protocol";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CATALOGUE = join(ROOT, "catalogue.json");

const SPEC_URL: Record<string, string> = {
  "2026-01-26":
    "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx?plain=1",
  draft:
    "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx?plain=1",
};

const BUCKETS: [string, string, string][] = [
  [
    "automatic",
    "Automatic",
    "Asserted directly from inside the iframe — read a host value, proxy a tool call, trigger a CSP violation. No human, runs headless.",
  ],
  [
    "auto-detect",
    "Auto-detect (await)",
    "The app triggers an action, then a host notification or callback settles the test automatically — no verdict to give.",
  ],
  [
    "operator-verify",
    "Operator / driver verdict",
    "The effect happens outside the iframe (a permission dialog, a new tab, a conversation turn); a human or the Playwright driver confirms it from the host surface.",
  ],
];

const OVERFIT_COLS = ["chatgpt", "claude", "alpic-playground"];
const OVERFIT_ROWS: string[][] = [
  [
    "Launch prompt",
    "#prompt-textarea, “run @app” (mention picker, 2× Enter)",
    "ProseMirror div[contenteditable], “run app”, 1 Enter",
    'textarea[name="message"], Enter',
  ],
  [
    "Widget iframe",
    'iframe[src*="oaiusercontent"]',
    'iframe[src*="claudemcpcontent"]',
    "iframe (same-origin)",
  ],
  ["Dismiss host chrome", "“Got it” modal", "“Accept All Cookies” banner", "—"],
  [
    "Permission dialog",
    "“Open link” (as <a>), “Download”",
    "“Open link” / “Download” (as <button>), “Allow”",
    "—",
  ],
  [
    "Send a ui/message",
    "sent directly",
    'drafts into composer → “Replace current text?” + button[aria-label="Send message"]',
    "—",
  ],
  [
    "Verify a conversation turn",
    "/backend-api/conversation/<id> API",
    "scrape document.body.innerText",
    "scrape innerText",
  ],
  [
    "Reset display mode",
    "real-click “Reset to inline” (gesture-gated)",
    "programmatic requestDisplayMode works",
    "—",
  ],
];

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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function localStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function specLink(e: CatalogueEntry): string {
  const base = SPEC_URL[e.spec];
  const label = `${e.spec} · L${e.line}`;
  return base
    ? `<a href="${base}#L${e.line}" target="_blank" rel="noopener">${esc(label)}</a>`
    : esc(label);
}

function main(): number {
  const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8")) as CatalogueEntry[];
  const impl = catalogue.filter((e) => e.implemented);

  let bucketSections = "";
  for (const [key, title, desc] of BUCKETS) {
    const rows = impl.filter((e) => e.bucket === key);
    let items = "";
    for (const e of rows) {
      const badge = e.askAgent ? ' <span class="tag">ask-agent</span>' : "";
      items +=
        `<tr><td class="mono">${esc(e.id)}${badge}</td>` +
        `<td class="mono">${esc(e.clause)}</td>` +
        `<td>${specLink(e)}</td></tr>`;
    }
    bucketSections +=
      `<h3>${esc(title)} <span class="count">${rows.length}</span></h3>` +
      `<p class="desc">${esc(desc)}</p>` +
      `<table class="tests"><tbody>${items}</tbody></table>`;
  }

  const overfitHead = OVERFIT_COLS.map((c) => `<th>${esc(c)}</th>`).join("");
  const overfitBody = OVERFIT_ROWS.map(
    (r) =>
      `<tr><td class="concern">${esc(r[0])}</td>` +
      r
        .slice(1)
        .map((cell) => `<td class="mono">${esc(cell)}</td>`)
        .join("") +
      "</tr>",
  ).join("");

  const generated = localStamp();
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>MCP Apps Conformance — how it works</title>
<style>
  :root { --line:#e6e8ec; --muted:#5b6573; --accent:#1a73e8; --ink:#171a1f; --bg:#fff; }
  * { box-sizing:border-box; }
  body { margin:0 auto; max-width:1040px; padding:32px 28px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); line-height:1.5; }
  a.back { color:var(--accent); text-decoration:none; font-size:13px; }
  h1 { font-size:20px; margin:8px 0 4px; }
  h2 { font-size:16px; margin:32px 0 8px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  h3 { font-size:14px; margin:20px 0 2px; }
  .gen { color:var(--muted); font-size:12px; margin-bottom:8px; }
  .desc { color:var(--muted); font-size:13px; margin:2px 0 8px; }
  .mono { font-family:ui-monospace,Menlo,monospace; font-size:12px; }
  .count { color:var(--muted); font-weight:400; font-size:12px; }
  .tag { font-size:10px; color:#8250df; background:#f3eefc; border-radius:5px; padding:1px 6px; margin-left:4px; }
  .pipeline { background:#f6f8fa; border:1px solid var(--line); border-radius:10px; padding:16px 18px; font-size:13px; }
  .pipeline ol { margin:0; padding-left:20px; } .pipeline li { margin:6px 0; }
  .pipeline code { font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#eef1f4; padding:1px 5px; border-radius:4px; }
  table { border-collapse:collapse; width:100%; font-size:13px; margin:6px 0 4px; }
  th, td { border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
  th { background:#f6f8fa; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#3c4043; }
  table.tests td { border-left:none; border-right:none; }
  table.tests a { color:var(--accent); text-decoration:none; } table.tests a:hover { text-decoration:underline; }
  td.concern { font-weight:600; white-space:nowrap; }
  .note { color:var(--muted); font-size:12px; font-style:italic; margin-top:8px; }
</style></head><body>
<a class="back" href="index.html">← Results</a>
<h1>How the conformance suite works</h1>
<div class="gen">Generated ${generated}</div>

<h2>The pipeline</h2>
<div class="pipeline"><ol>
<li>The MCP server exposes a <code>ui://</code> runner resource.</li>
<li>The host renders it in a <strong>sandboxed iframe</strong> — the <strong>TestSuite</strong>, which owns the test definitions and the ext-apps <code>App</code> (MCP-app) communication.</li>
<li>A test <strong>asserts the host's behavior</strong> against the spec; when it needs the host to do something it can't do from inside the iframe, it emits a typed <code>CapabilityRequest</code> and awaits the result.</li>
<li>The suite installs one control seam at <code>window.__mcpConformance</code> (<code>listTests</code> / <code>start</code> / <code>poll</code> / <code>resolve</code>). The <strong>Runner</strong> polls it (via <code>frame.evaluate</code>), dispatches each request to the active <strong>Host</strong>, and resolves it back — the suite pulls, the Runner polls.</li>
<li>The <strong>Host</strong> is the only platform-specific piece (a Playwright <code>BrowserHost</code> today; a desktop host later). It automates the real host — clicks, dialogs, conversation checks — and returns each result.</li>
<li><code>report.ts</code> renders the results matrix (<a class="back" href="index.html">Results</a>); see also the <a class="back" href="architecture.html">architecture</a>.</li>
</ol></div>
<p class="note">The durable seam is the <code>window.__mcpConformance</code> protocol. The fragile part is the per-host DOM the driver must click — see the last section.</p>

<h2>Test buckets</h2>
${bucketSections}
<p class="note">ask-agent is a cross-cutting tag: the app sends a <code>ui/message</code> asking the model to act (call a tool, list tools, recall context), so the result depends on the agent — not just the host bridge.</p>

<h2>Where the driver overfits the host</h2>
<p class="desc">The driver clicks real product UIs, not an API, so it hard-codes host-specific selectors and flows. These are brittle to host redesigns.</p>
<table><thead><tr><th>Concern</th>${overfitHead}</tr></thead><tbody>${overfitBody}</tbody></table>
</body></html>`;

  const out = join(ROOT, "docs", "how-it-works.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, doc);
  console.log(`Wrote ${out}`);
  return 0;
}

main();
