#!/usr/bin/env python3
"""Generate docs/how-it-works.html — the conformance methodology page.

Explains the pipeline, the test buckets (automatic / auto-detect / operator
verdict, + the ask-agent tag), which test is in which bucket (from
catalogue.json), and where the Playwright driver overfits each host's DOM.

    python3 notte/how_it_works.py
"""
import html
import json
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOGUE = HERE / "catalogue.json"
SPEC_URL = {
    "2026-01-26": "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx?plain=1",
    "draft": "https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx?plain=1",
}

BUCKETS = [
    ("automatic", "Automatic", "Asserted directly from inside the iframe — read a host value, proxy a tool call, trigger a CSP violation. No human, runs headless."),
    ("auto-detect", "Auto-detect (await)", "The app triggers an action, then a host notification or callback settles the test automatically — no verdict to give."),
    ("operator-verify", "Operator / driver verdict", "The effect happens outside the iframe (a permission dialog, a new tab, a conversation turn); a human or the Playwright driver confirms it from the host surface."),
]

# Where the driver reaches into product-specific DOM (from notte/conformance.py).
OVERFIT_COLS = ["chatgpt", "claude", "alpic-playground"]
OVERFIT_ROWS = [
    ("Launch prompt", "#prompt-textarea, “run @app” (mention picker, 2× Enter)", "ProseMirror div[contenteditable], “run app”, 1 Enter", "textarea[name=\"message\"], Enter"),
    ("Widget iframe", "iframe[src*=\"oaiusercontent\"]", "iframe[src*=\"claudemcpcontent\"]", "iframe (same-origin)"),
    ("Dismiss host chrome", "“Got it” modal", "“Accept All Cookies” banner", "—"),
    ("Permission dialog", "“Open link” (as <a>), “Download”", "“Open link” / “Download” (as <button>), “Allow”", "—"),
    ("Send a ui/message", "sent directly", "drafts into composer → “Replace current text?” + button[aria-label=\"Send message\"]", "—"),
    ("Verify a conversation turn", "/backend-api/conversation/<id> API", "scrape document.body.innerText", "scrape innerText"),
    ("Reset display mode", "real-click “Reset to inline” (gesture-gated)", "programmatic requestDisplayMode works", "—"),
]


def spec_link(e: dict) -> str:
    base = SPEC_URL.get(e["spec"])
    label = f'{e["spec"]} · L{e["line"]}'
    return f'<a href="{base}#L{e["line"]}" target="_blank" rel="noopener">{html.escape(label)}</a>' if base else html.escape(label)


def main() -> int:
    catalogue = json.loads(CATALOGUE.read_text())
    impl = [e for e in catalogue if e.get("implemented")]

    bucket_sections = ""
    for key, title, desc in BUCKETS:
        rows = [e for e in impl if e.get("bucket") == key]
        items = ""
        for e in rows:
            badge = ' <span class="tag">ask-agent</span>' if e.get("askAgent") else ""
            items += (
                f'<tr><td class="mono">{html.escape(e["id"])}{badge}</td>'
                f'<td class="mono">{html.escape(e["clause"])}</td>'
                f'<td>{spec_link(e)}</td></tr>'
            )
        bucket_sections += (
            f'<h3>{html.escape(title)} <span class="count">{len(rows)}</span></h3>'
            f'<p class="desc">{html.escape(desc)}</p>'
            f'<table class="tests"><tbody>{items}</tbody></table>'
        )

    overfit_head = "".join(f"<th>{html.escape(c)}</th>" for c in OVERFIT_COLS)
    overfit_body = "".join(
        "<tr><td class=\"concern\">" + html.escape(r[0]) + "</td>"
        + "".join(f'<td class="mono">{html.escape(cell)}</td>' for cell in r[1:])
        + "</tr>"
        for r in OVERFIT_ROWS
    )

    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>MCP Apps Conformance — how it works</title>
<style>
  :root {{ --line:#e6e8ec; --muted:#5b6573; --accent:#1a73e8; --ink:#171a1f; --bg:#fff; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0 auto; max-width:1040px; padding:32px 28px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); line-height:1.5; }}
  a.back {{ color:var(--accent); text-decoration:none; font-size:13px; }}
  h1 {{ font-size:20px; margin:8px 0 4px; }}
  h2 {{ font-size:16px; margin:32px 0 8px; padding-bottom:6px; border-bottom:1px solid var(--line); }}
  h3 {{ font-size:14px; margin:20px 0 2px; }}
  .gen {{ color:var(--muted); font-size:12px; margin-bottom:8px; }}
  .desc {{ color:var(--muted); font-size:13px; margin:2px 0 8px; }}
  .mono {{ font-family:ui-monospace,Menlo,monospace; font-size:12px; }}
  .count {{ color:var(--muted); font-weight:400; font-size:12px; }}
  .tag {{ font-size:10px; color:#8250df; background:#f3eefc; border-radius:5px; padding:1px 6px; margin-left:4px; }}
  .pipeline {{ background:#f6f8fa; border:1px solid var(--line); border-radius:10px; padding:16px 18px; font-size:13px; }}
  .pipeline ol {{ margin:0; padding-left:20px; }} .pipeline li {{ margin:6px 0; }}
  .pipeline code {{ font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#eef1f4; padding:1px 5px; border-radius:4px; }}
  table {{ border-collapse:collapse; width:100%; font-size:13px; margin:6px 0 4px; }}
  th, td {{ border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }}
  th {{ background:#f6f8fa; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#3c4043; }}
  table.tests td {{ border-left:none; border-right:none; }}
  table.tests a {{ color:var(--accent); text-decoration:none; }} table.tests a:hover {{ text-decoration:underline; }}
  td.concern {{ font-weight:600; white-space:nowrap; }}
  .note {{ color:var(--muted); font-size:12px; font-style:italic; margin-top:8px; }}
</style></head><body>
<a class="back" href="index.html">← Results</a>
<h1>How the conformance suite works</h1>
<div class="gen">Generated {generated}</div>

<h2>The pipeline</h2>
<div class="pipeline"><ol>
<li>The MCP server exposes a <code>ui://</code> runner resource.</li>
<li>The host renders it in a <strong>sandboxed iframe</strong>.</li>
<li>The runner (an ext-apps <code>App</code>) drives the postMessage / JSON-RPC bridge and <strong>asserts the host's behavior</strong> against the spec.</li>
<li>It exposes its state on <code>window.__conformance</code> and a <code>window.__conformanceDrive()</code> function — the <strong>control seam</strong> a driver uses. The driver calls that function directly (via <code>frame.evaluate</code>); a <code>conformance:drive</code> <code>MessageEvent</code> is the fallback.</li>
<li>The optional Playwright driver (<code>notte/conformance.py</code>) automates the human steps on a real host and collects results.</li>
<li><code>report.py</code> renders the results matrix (<a class="back" href="index.html">Results</a>).</li>
</ol></div>
<p class="note">The durable seam is the <code>window.__conformance</code> protocol. The fragile part is the per-host DOM the driver must click — see the last section.</p>

<h2>Test buckets</h2>
{bucket_sections}
<p class="note">ask-agent is a cross-cutting tag: the app sends a <code>ui/message</code> asking the model to act (call a tool, list tools, recall context), so the result depends on the agent — not just the host bridge.</p>

<h2>Where the driver overfits the host</h2>
<p class="desc">The driver clicks real product UIs, not an API, so it hard-codes host-specific selectors and flows. These are brittle to host redesigns.</p>
<table><thead><tr><th>Concern</th>{overfit_head}</tr></thead><tbody>{overfit_body}</tbody></table>
</body></html>"""

    out = HERE.parent / "docs" / "how-it-works.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(doc)
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
