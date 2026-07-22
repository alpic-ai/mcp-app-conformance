#!/usr/bin/env python3
"""Build a self-contained HTML matrix from the catalogue + latest driver results.

Reads notte/catalogue.json (every requirement + clause + spec link + implemented
flag) and the latest notte/out/<host>/results-*.json per host. Tests are grouped
by RFC-2119 clause, one column per host, PASS/FAIL only, with a "Not yet
implemented" section. Static (data inlined) — writes docs/index.html, which
GitHub Pages serves (Settings → Pages → main / docs).

    python3 notte/report.py        # then open docs/index.html or push to publish
"""
import html
import json
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
CATALOGUE = HERE / "catalogue.json"

SPEC_URL = {
    "2026-01-26": "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx?plain=1",
    "draft": "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx?plain=1",
}
CLAUSE_ORDER = ["MUST", "MUST NOT", "REQUIRED", "SHOULD", "SHOULD NOT", "MAY"]
HOST_LABEL = {"playground": "alpic-playground"}  # display name per host dir
STATUS_CLASS = {"PASS": "pass", "FAIL": "fail", "TIMEOUT": "fail", "NOTRUN": "notrun", "": "notrun"}


def latest_result(host_dir: Path) -> dict | None:
    files = sorted(host_dir.glob("results-*.json"))
    if not files:
        return None
    d = json.loads(files[-1].read_text())
    d["_file"] = files[-1].name
    return d


def fmt_time(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return iso


def spec_link(e: dict) -> str:
    base = SPEC_URL.get(e["spec"])
    label = f'{e["spec"]} · L{e["line"]}'
    if not base:
        return html.escape(label)
    return f'<a href="{base}#L{e["line"]}" target="_blank" rel="noopener">{html.escape(label)}</a>'


def main() -> int:
    catalogue = json.loads(CATALOGUE.read_text())
    results: dict[str, dict] = {}
    if OUT.exists():
        for hd in sorted(p for p in OUT.iterdir() if p.is_dir()):
            r = latest_result(hd)
            if r:
                results[hd.name] = r
    hosts = list(results)
    by_host_row = {h: {row.get("id"): row for row in results[h].get("rows", [])} for h in hosts}
    values: dict[str, str] = {}  # "id::host" -> pretty JSON of the captured value

    def cell(host: str, rid: str) -> str:
        row = by_host_row[host].get(rid)
        if not row:
            return '<td class="st notrun">·</td>'
        status = (row.get("status") or "").strip()
        cls = STATUS_CLASS.get(status, "skip")
        driven = results[host].get("driven", {}).get(rid, "")
        parts = [p for p in [row.get("message"), (f"driver: {driven}" if driven else "")] if p]
        tip = has = ""
        if parts:
            has = " has-tip"
            tip = '<span class="tip">' + "<br>".join(html.escape(p) for p in parts) + "</span>"
        val = ""
        if row.get("value") is not None:
            key = f"{rid}::{host}"
            values[key] = json.dumps(row["value"], indent=2)
            val = f"<button type=\"button\" class=\"val-link\" onclick=\"openVal('{key}')\" title=\"Show the value the host provided\">ⓥ</button>"
        return f'<td class="st {cls}{has}">{html.escape(status or "—")}{val}{tip}</td>'

    impl = [e for e in catalogue if e.get("implemented")]
    pending = [e for e in catalogue if not e.get("implemented")]
    ncol = 1 + len(hosts)

    head_cells = "".join(
        f'<th class="host"><div class="host-name">{html.escape(HOST_LABEL.get(h, h))}</div>'
        f'<div class="host-meta">{html.escape(fmt_time(results[h].get("capturedAt")))}</div></th>'
        for h in hosts
    )

    body = ""
    for clause in CLAUSE_ORDER:
        rows = [e for e in impl if e["clause"] == clause]
        if not rows:
            continue
        body += f'<tr class="section"><td colspan="{ncol}">{html.escape(clause)}</td></tr>'
        for e in rows:
            body += (
                f'<tr><td class="id">{html.escape(e["id"])}'
                f'<div class="sub">{html.escape(e.get("vantage", ""))} · {spec_link(e)}</div></td>'
                + "".join(cell(h, e["id"]) for h in hosts)
                + "</tr>"
            )

    pend = ""
    if pending:
        pend = '<h2>Not yet implemented</h2><table class="pending"><thead><tr><th>Test</th><th>Clause</th><th>Vantage</th><th>Spec</th></tr></thead><tbody>'
        for clause in CLAUSE_ORDER:
            for e in [x for x in pending if x["clause"] == clause]:
                pend += (
                    f'<tr><td class="id">{html.escape(e["id"])}</td>'
                    f'<td>{html.escape(e["clause"])}</td><td>{html.escape(e.get("vantage", ""))}</td>'
                    f"<td>{spec_link(e)}</td></tr>"
                )
        pend += "</tbody></table>"

    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    hostlist = ", ".join(html.escape(h) for h in hosts) or "no results yet — run the driver"
    values_js = json.dumps(values)  # captured host values, embedded for the value modal
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>MCP Apps Conformance — results</title>
<style>
  :root {{ --line:#e6e8ec; --muted:#5b6573; --pass:#137333; --pass-bg:#e6f4ea;
           --fail:#c5221f; --fail-bg:#fce8e6; --notrun:#80868b; --notrun-bg:#f1f3f4;
           --skip:#b06000; --skip-bg:#fef7e0; --accent:#1a73e8; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0 auto; max-width:1040px; padding:32px 28px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#171a1f; }}
  h1 {{ font-size:18px; margin:0 0 2px; }}
  h2 {{ font-size:15px; margin:28px 0 8px; }}
  .gen {{ color:var(--muted); font-size:12px; margin-bottom:6px; }}
  .gen a {{ color:var(--accent); text-decoration:none; }} .gen a:hover {{ text-decoration:underline; }}
  .note {{ color:var(--muted); font-size:11px; margin-bottom:16px; font-style:italic; }}
  table {{ border-collapse:separate; border-spacing:0; font-size:13px; }}
  th, td {{ border-bottom:1px solid var(--line); padding:8px 12px; text-align:left; vertical-align:top; }}
  thead th {{ position:sticky; top:0; background:#fff; z-index:2; }}
  td.id, th.corner {{ position:sticky; left:0; background:#fff; z-index:1; max-width:360px; }}
  td.id {{ font-family:ui-monospace,Menlo,monospace; font-size:12px; }}
  .sub {{ color:var(--muted); font-size:10px; margin-top:2px; }}
  .sub a {{ color:var(--accent); text-decoration:none; }} .sub a:hover {{ text-decoration:underline; }}
  th.host {{ min-width:110px; }} .host-name {{ font-weight:600; }}
  .host-meta {{ color:var(--muted); font-size:10px; font-weight:400; margin-top:2px; }}
  tr.section td {{ background:#f1f3f4; font-weight:700; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#3c4043; position:sticky; left:0; }}
  td.st {{ font-family:ui-monospace,Menlo,monospace; font-size:11px; font-weight:600; text-align:center; position:relative; }}
  .has-tip {{ cursor:help; }}
  .tip {{ display:none; position:absolute; left:50%; top:calc(100% + 4px); transform:translateX(-50%); z-index:10;
          background:#171a1f; color:#fff; padding:7px 9px; border-radius:6px; font-family:-apple-system,sans-serif;
          font-size:11px; font-weight:400; line-height:1.45; text-align:left; white-space:normal; width:max-content;
          max-width:340px; box-shadow:0 6px 20px rgba(0,0,0,.3); pointer-events:none; }}
  .has-tip:hover .tip {{ display:block; }}
  .pass {{ color:var(--pass); background:var(--pass-bg); }}
  .fail {{ color:var(--fail); background:var(--fail-bg); }}
  .notrun {{ color:var(--notrun); background:var(--notrun-bg); }}
  .skip {{ color:var(--skip); background:var(--skip-bg); }}
  .legend {{ margin:10px 0 16px; display:flex; gap:8px; flex-wrap:wrap; font-size:11px; align-items:center; }}
  .legend span {{ padding:2px 8px; border-radius:6px; }}
  table.pending td.id {{ position:static; }} table.pending {{ color:var(--muted); }}
  table.pending a {{ color:var(--accent); text-decoration:none; }} table.pending a:hover {{ text-decoration:underline; }}
  .val-link {{ border:none; background:transparent; cursor:pointer; color:var(--accent); font-size:11px; margin-left:5px; padding:0; }}
  .val-dialog {{ border:1px solid var(--line); border-radius:12px; padding:18px; max-width:620px; width:90vw; }}
  .val-dialog::backdrop {{ background:rgba(0,0,0,0.4); }}
  .val-head {{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }}
  .val-head h2 {{ font-size:14px; margin:0; font-family:ui-monospace,Menlo,monospace; }}
  .val-close {{ border:none; background:transparent; font-size:22px; line-height:1; cursor:pointer; color:var(--muted); }}
  #val-body {{ background:#f6f8fa; padding:12px; border-radius:6px; overflow:auto; font-size:11px; font-family:ui-monospace,Menlo,monospace; max-height:62vh; white-space:pre; margin:0; }}
</style></head><body>
<h1>MCP Apps Conformance — results</h1>
<div class="gen">Generated {generated} · hosts: {hostlist} · <a href="how-it-works.html">How it works ↗</a></div>
<div class="note">Single run per host, some manual verdicts operator-assisted. Grouped by RFC-2119 clause — a FAIL under SHOULD/MAY means the optional behavior isn't supported, not a spec violation.</div>
<div class="legend"><span class="pass">PASS</span><span class="fail">FAIL / TIMEOUT</span><span class="notrun">not run</span>&nbsp;hover a cell for the message / driver action · click a test's spec link for the exact line</div>
<table><thead><tr><th class="corner">Test</th>{head_cells}</tr></thead><tbody>{body}</tbody></table>
{pend}
<dialog id="val-dialog" class="val-dialog">
  <div class="val-head"><h2 id="val-title">value</h2><button type="button" class="val-close" onclick="document.getElementById('val-dialog').close()">×</button></div>
  <pre id="val-body"></pre>
</dialog>
<script>
const VALUES = {values_js};
function openVal(k) {{
  document.getElementById('val-title').textContent = k;
  document.getElementById('val-body').textContent = VALUES[k] || '(no value)';
  document.getElementById('val-dialog').showModal();
}}
</script>
</body></html>"""

    out_file = HERE.parent / "docs" / "index.html"  # tracked path served by GitHub Pages
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(doc)
    print(f"Wrote {out_file}")
    print(f"Hosts: {', '.join(f'{h} ({results[h].get('_file')})' for h in hosts) or 'none'}")
    print(f"Implemented: {len(impl)} · pending: {len(pending)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
