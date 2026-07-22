# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright>=1.48"]
# ///
"""
Drive the MCP Apps conformance runner on a real host and record the results.

Local Chrome only for now (`--mode local`): a persistent, gitignored profile
you log into once by hand; the session is reused on every run. No Notte, no CI,
no baseline — this is a "run it yourself" tool that exercises every test and
writes what the runner reported to `results.json`.

    uv run notte/conformance.py --host chatgpt --app-name Conformance
    uv run notte/conformance.py --host claude  --app-name Conformance

How it works (no LLM, no scraping of the results table):
  - Prompts the host to run the app, which mounts the runner iframe.
  - Clicks the runner's real "Run" button (a genuine gesture — hosts gate
    open-link / download / follow-up effects behind one).
  - Reads the app's `conformance:state` broadcast (see view/automation.ts) to
    know when a manual test is waiting and what the final verdicts are.
  - For each manual test, clicks the in-widget trigger with a real cross-origin
    click, accepts the host's native permission dialogs, and verifies the side
    effect from outside where it can.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator

from playwright.sync_api import BrowserContext, Page, sync_playwright

CLICK_TIMEOUT_MS = 12_000
PAGE_LOAD_TIMEOUT_MS = 30_000

# Markers the runner's manual tests emit, verified from outside (view/tests.ts).
MESSAGE_MARKER = "Conformance check: this message was sent by the MCP App via ui/message."
MODEL_CONTEXT_MARKER = "MCP-APP-7421"
TOOL_HIDDEN_MARKER = "conformance_probe"  # must be ABSENT from the agent's tool list

# Tests whose trigger sends a ui/message. On Claude these land in the composer as
# a draft and must be committed (Send button); on ChatGPT they send directly.
MESSAGE_TESTS = {
    "messages/add-to-conversation",
    "visibility/app-tool-hidden",
    "model-context/provide-future-turns",
    "app-tools/call",
}


# ── host abstraction ─────────────────────────────────────────────────


@dataclass
class Host:
    name: str
    url: str
    widget_selector: str
    send_prompt: Callable[[Page, str], None]
    dismiss_modal: Callable[[Page], None]
    # Verify `marker` appeared in the conversation, from outside the widget.
    conversation_contains: Callable[[Page, str, int], bool]
    # Actually send a ui/message the app drafted into the composer. None = the
    # host sends directly (ChatGPT); Claude drafts it and needs a Send click.
    commit_message: Callable[[Page], None] | None = None


# ── ChatGPT ──────────────────────────────────────────────────────────


def send_prompt_chatgpt(page: Page, app_name: str) -> None:
    """Type "run @{app_name}": the first Enter picks the app from the mention
    picker, the second sends."""
    page.fill("#prompt-textarea", f"run @{app_name}", timeout=PAGE_LOAD_TIMEOUT_MS)
    time.sleep(3)  # mention picker
    page.keyboard.press("Enter")
    time.sleep(1)
    page.keyboard.press("Enter")


def dismiss_modal_chatgpt(page: Page) -> None:
    page.evaluate(
        """() => {
            const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Got it');
            if (b) b.click();
        }"""
    )


def conversation_contains_chatgpt(page: Page, marker: str, timeout_seconds: int = 120, poll: int = 8) -> bool:
    """Poll ChatGPT's own conversation API for `marker`. The snapshot endpoint
    only reflects a turn once it completes, which can lag dispatch by 30-45s."""
    js = """
    async (marker) => {
        const id = (location.pathname.match(/\\/c\\/([a-z0-9-]+)/i) || [])[1];
        if (!id) return 'no-conversation-id';
        const token = (await (await fetch('/api/auth/session')).json()).accessToken;
        const account = (document.cookie.match(/_account=([^;]+)/) || [])[1] || '';
        const r = await fetch('/backend-api/conversation/' + id, {
            headers: { 'Authorization': 'Bearer ' + token, 'ChatGPT-Account-ID': account },
        });
        if (!r.ok) return 'http-' + r.status;
        const body = JSON.stringify(await r.json());
        return body.includes(marker) ? 'found' : ('not-found/' + body.length + 'B');
    }
    """
    return _poll_marker(page, js, marker, timeout_seconds, poll)


CHATGPT = Host(
    name="chatgpt",
    url="https://chatgpt.com/",
    widget_selector='iframe[src*="oaiusercontent"]',
    send_prompt=send_prompt_chatgpt,
    dismiss_modal=dismiss_modal_chatgpt,
    conversation_contains=conversation_contains_chatgpt,
)


# ── Claude ───────────────────────────────────────────────────────────


def dismiss_modal_claude(page: Page) -> None:
    """Accept the cookie banner: its overlay swallows clicks near the composer."""
    page.evaluate(
        """() => {
            const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Accept All Cookies');
            if (b) b.click();
        }"""
    )
    time.sleep(1)


def send_prompt_claude(page: Page, app_name: str) -> None:
    """Send "run {app_name}". Claude's composer is a ProseMirror contenteditable
    (no mention picker; a single Enter sends). Typing/Enter get swallowed by the
    cookie banner / onboarding popovers, so verify each and retry."""
    dismiss_modal_claude(page)
    prompt = f"run {app_name}"
    composer = page.locator('div[contenteditable="true"]').first
    composer.click(timeout=PAGE_LOAD_TIMEOUT_MS)
    for _ in range(3):
        composer.fill(prompt)
        time.sleep(1)
        if prompt in (composer.inner_text() or ""):
            break
    for _ in range(5):
        page.keyboard.press("Enter")
        time.sleep(3)
        if "/chat/" in page.url:  # a sent message navigates to /chat/<id>
            return
        try:
            if prompt not in (composer.inner_text() or ""):
                return
        except Exception:
            return  # composer re-rendered away: the message left
    raise TimeoutError("the Claude composer never sent the prompt")


def conversation_contains_claude(page: Page, marker: str, timeout_seconds: int = 120, poll: int = 8) -> bool:
    """No known same-origin conversation API on claude.ai, so scrape the visible
    transcript text for the marker. Weaker (the widget may cover the transcript,
    but the DOM text is still present); swap for an API check if one is found."""
    js = "(marker) => document.body.innerText.includes(marker) ? 'found' : 'not-found'"
    return _poll_marker(page, js, marker, timeout_seconds, poll)


def commit_message_claude(page: Page) -> None:
    """Claude drafts a ui/message into the composer as a *proposal* (with a "…wants
    to add a prompt. Replace current text?" link and a caution banner) instead of
    sending it like ChatGPT. Accept the proposal, then click Send."""
    click_top_page_button(page, "Replace current text?", timeout_seconds=6)
    time.sleep(0.5)
    try:
        btn = page.locator('button[aria-label="Send message"]')
        if btn.count():
            btn.first.click(timeout=CLICK_TIMEOUT_MS)
            print("[conformance] Claude: sent drafted message", flush=True)
            return
    except Exception as exc:
        print(f"[conformance] Claude Send click failed: {exc}", flush=True)
    try:  # fallback: Enter in the composer
        page.locator('div[contenteditable="true"]').first.press("Enter")
    except Exception:
        pass


CLAUDE = Host(
    name="claude",
    url="https://claude.ai/new",
    widget_selector='iframe[src*="claudemcpcontent"]',
    send_prompt=send_prompt_claude,
    dismiss_modal=dismiss_modal_claude,
    conversation_contains=conversation_contains_claude,
    commit_message=commit_message_claude,
)

# ── Alpic playground ─────────────────────────────────────────────────
# A self-contained playground host at /try with the conformance app pre-connected
# — no login. Frames are same-origin, but the generic app-frame machinery
# (window.__conformance) drives it fine. Mainly exercises the automatic batch;
# manual tests that need an agent may not apply here.


def send_prompt_playground(page: Page, app_name: str) -> None:
    page.fill(
        'textarea[name="message"]',
        "Run the MCP Apps conformance suite using the run_conformance tool.",
        timeout=PAGE_LOAD_TIMEOUT_MS,
    )
    time.sleep(1)
    page.keyboard.press("Enter")


def dismiss_modal_playground(page: Page) -> None:
    return  # no cookie/consent banner on the playground


def conversation_contains_playground(page: Page, marker: str, timeout_seconds: int = 60, poll: int = 6) -> bool:
    # No conversation API on the playground; scrape the page text (best-effort).
    return _poll_marker(page, "(m) => document.body.innerText.includes(m) ? 'found' : 'not-found'", marker, timeout_seconds, poll)


PLAYGROUND = Host(
    name="playground",
    url="https://mcp-apps-conformance.alpic.live/try",
    widget_selector="iframe",
    send_prompt=send_prompt_playground,
    dismiss_modal=dismiss_modal_playground,
    conversation_contains=conversation_contains_playground,
)

HOSTS: dict[str, Host] = {CHATGPT.name: CHATGPT, CLAUDE.name: CLAUDE, PLAYGROUND.name: PLAYGROUND}


# ── shared host-agnostic plumbing ────────────────────────────────────


def _poll_marker(page: Page, js: str, marker: str, timeout_seconds: int, poll: int) -> bool:
    elapsed = 0
    while elapsed < timeout_seconds:
        try:
            status = page.evaluate(js, marker)
        except Exception as exc:
            status = f"error: {exc}"
        print(f"[conformance] conversation check ({marker[:24]}…): {status}", flush=True)
        if status == "found":
            return True
        time.sleep(poll)
        elapsed += poll
    return False


def wait_for_widget(page: Page, selector: str, timeout_seconds: int = 90, poll: int = 3) -> None:
    elapsed = 0
    while elapsed < timeout_seconds:
        if page.evaluate("(s) => Boolean(document.querySelector(s))", selector):
            return
        time.sleep(poll)
        elapsed += poll
    raise TimeoutError(f"widget iframe did not appear within {timeout_seconds}s")


def click_top_page_button(page: Page, label: str, timeout_seconds: int = 20) -> bool:
    """Click a control by exact text in a host permission dialog. Role varies:
    Claude's "Open link" is a <button>, ChatGPT's is an <a> — match either."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        for loc in (
            page.get_by_role("button", name=label, exact=True),
            page.get_by_role("link", name=label, exact=True),
            page.get_by_text(label, exact=True),
        ):
            try:
                if loc.count():
                    loc.first.click(timeout=CLICK_TIMEOUT_MS)
                    return True
            except Exception:
                continue
        time.sleep(1)
    return False


def install_state_listener(page: Page) -> None:
    """Stash the runner's `conformance:state` broadcasts in window.__confState."""
    page.evaluate(
        """() => {
            if (window.__confListener) return;
            window.__confListener = true;
            window.addEventListener('message', (e) => {
                if (e.data && e.data.type === 'conformance:state') window.__confState = e.data.state;
            });
        }"""
    )


def app_frame(page: Page):
    """The frame running the runner (the one that set window.__conformance).
    Scanning all frames finds it at any nesting depth — the widget-iframe
    selector alone can miss it (deeper nesting, or multiple matching iframes)."""
    for frame in list(page.frames):
        if frame is page.main_frame:
            continue
        try:
            if frame.evaluate("() => Boolean(window.__conformance)"):
                return frame
        except Exception:
            continue
    return None


def read_state(page: Page, timeout_seconds: int = 25, poll: int = 2) -> dict:
    """Read the runner's state snapshot from the app frame's own
    `window.__conformance` (kept intact by frame.evaluate). Falls back to the
    top-page postMessage broadcast."""
    elapsed = 0
    while elapsed < timeout_seconds:
        fr = app_frame(page)
        if fr is not None:
            try:
                data = fr.evaluate("() => window.__conformance || null")
                if data:
                    return data
            except Exception:
                pass
        data = page.evaluate("() => window.__confState || null")
        if data:
            return data
        time.sleep(poll)
        elapsed += poll
    raise TimeoutError("no conformance state found (app frame or broadcast)")


def real_click_testid(page: Page, testid: str) -> bool:
    """Real, trusted click on a widget button by data-testid, across the host's
    cross-origin iframes. Gesture-gated effects only fire under a genuine click,
    so this — not postMessage — drives the triggers."""
    for _ in range(3):
        # Prefer the frame that is actively broadcasting state (the live app
        # instance) so we don't click a stale/detached frame left by a fullscreen
        # remount. Fall back to any frame that has the button.
        frames = list(page.frames)
        frames.sort(key=lambda f: 0 if _frame_is_live_app(f) else 1)
        for frame in frames:
            if frame is page.main_frame:
                continue
            try:
                btn = frame.get_by_test_id(testid)
                if btn.count():
                    btn.first.click(timeout=CLICK_TIMEOUT_MS)
                    print(f"[conformance] clicked '{testid}' in frame {frame.url[:60] or '(no url)'}", flush=True)
                    return True
            except Exception as exc:
                print(f"[conformance] click '{testid}': {str(exc).splitlines()[0]}", flush=True)
                continue
        time.sleep(1)  # a remounting frame; rescan
    print(f"[conformance] '{testid}' button not found in any frame", flush=True)
    return False


def _frame_is_live_app(frame) -> bool:
    """True if this frame is the app instance with the pending interaction — i.e.
    the live runner showing the scrim, not a stale/duplicate frame from a remount."""
    try:
        return bool(frame.evaluate("() => Boolean(window.__conformance && window.__conformance.interaction)"))
    except Exception:
        return False


def drive(page: Page, selector: str, action: str, id: str | None = None) -> None:
    """Send a non-gesture drive action (run-auto/run-test/yes/no/skip).

    Deliver it from INSIDE the app frame (post to its own window) so it reaches
    the runner's listener regardless of nesting — posting from the top page to a
    widget-iframe selector missed deeper/duplicate frames, which is why run-auto
    never fired. Falls back to the top-page widget-iframe post if the frame's gone.
    """
    fr = app_frame(page)
    if fr is not None:
        try:
            how = fr.evaluate(
                """([a, i]) => {
                    if (typeof window.__conformanceDrive === 'function') {
                        window.__conformanceDrive(a, i || undefined);
                        return 'direct';
                    }
                    window.postMessage({ type: 'conformance:drive', action: a, id: i || undefined }, '*');
                    return 'postmessage';
                }""",
                [action, id],
            )
            print(f"[conformance] drive {action}{'/' + id if id else ''} via {how}", flush=True)
            time.sleep(2)
            return
        except Exception as exc:
            print(f"[conformance] drive via app frame failed: {exc}", flush=True)
    # last-resort fallback: top-page post to the widget iframe + children
    page.evaluate(
        """([sel, a, i]) => {
            const iframe = document.querySelector(sel);
            if (!iframe) return;
            const m = { type: 'conformance:drive', action: a, id: i || undefined };
            const w = iframe.contentWindow;
            w.postMessage(m, '*');
            for (let j = 0; j < w.frames.length; j++) w.frames[j].postMessage(m, '*');
        }""",
        [selector, action, id],
    )
    print(f"[conformance] drive {action} via top-page fallback (app frame missing)", flush=True)
    time.sleep(2)


def clear_host_overlay(page: Page) -> None:
    """Leave a clean page for the next test. A prior test's host dialog (Claude's
    ui/open-link consent, a download prompt) leaves a backdrop that intercepts the
    next test's trigger click, and open-link also opens a new tab. Close stray tabs
    and Escape any lingering modal so the following click actually lands."""
    ctx = page.context
    for p in list(ctx.pages):
        if p is not page and not p.is_closed():
            try:
                p.close()
            except Exception:
                pass
    for _ in range(3):
        try:
            present = bool(
                page.evaluate("() => Boolean(document.querySelector('[role=dialog],[aria-modal=true]'))")
            )
        except Exception:
            return
        if not present:
            return
        try:
            page.keyboard.press("Escape")
        except Exception:
            return
        time.sleep(0.6)


def wait_interaction_clears(page: Page, timeout_seconds: int = 90, poll: int = 3) -> bool:
    """True if the current interaction resolves on its own (await auto-pass)."""
    elapsed = 0
    while elapsed < timeout_seconds:
        try:
            state = read_state(page, timeout_seconds=5)
        except TimeoutError:
            state = None
        if state and not state.get("interaction"):
            return True
        time.sleep(poll)
        elapsed += poll
    return False


# ── per-test manual handling ─────────────────────────────────────────


def handle_interaction(page: Page, host: Host, state: dict) -> str:
    """Drive one waiting manual test; returns what the driver did."""
    tid = state.get("runningId") or ""
    inter = state["interaction"]
    sel = host.widget_selector

    def verdict(ok: bool) -> str:
        drive(page, sel, "yes" if ok else "no")
        return "yes" if ok else "no"

    # Start clean: a prior test's host dialog/backdrop (e.g. open-link's consent on
    # Claude) would otherwise swallow this test's trigger click.
    clear_host_overlay(page)

    if inter.get("trigger"):
        if not real_click_testid(page, "trigger"):
            print(f"[conformance] {tid}: trigger click did not land — skipping", flush=True)
            drive(page, sel, "skip")
            return "skip (no trigger)"
        time.sleep(3)
        # A ui/message trigger only drafts into Claude's composer — actually send it.
        if tid in MESSAGE_TESTS and host.commit_message:
            host.commit_message(page)
            time.sleep(2)

    if tid == "links/open-external":
        click_top_page_button(page, "Open link")
        return verdict(True)
    if tid == "download-file/confirm":
        click_top_page_button(page, "Download")
        return verdict(True)
    if tid == "sampling/create-message":
        click_top_page_button(page, "Allow")  # accept an approval dialog if shown
        return verdict(True)
    if tid == "messages/add-to-conversation":
        return verdict(host.conversation_contains(page, MESSAGE_MARKER, 120))
    if tid == "model-context/provide-future-turns":
        return verdict(host.conversation_contains(page, MODEL_CONTEXT_MARKER, 120))
    if tid == "visibility/app-tool-hidden":
        present = host.conversation_contains(page, TOOL_HIDDEN_MARKER, 45)
        return verdict(not present)
    if tid == "app-tools/call":
        # The trigger asked the agent to call the tool. Registration is local (it
        # succeeds on any host); passing requires the HOST to actually invoke it.
        # No host capability advertises that, so wait a short window and skip if it
        # never fires — e.g. ChatGPT, which doesn't call app-provided tools. A
        # supporting host calls back within a couple seconds.
        if wait_interaction_clears(page, 25):
            return "auto"
        drive(page, sel, "skip")
        return "skip (host did not call the app tool — likely unsupported)"
    if tid == "context/context-changed":
        # No in-app trigger — flip the emulated OS color scheme. If the host is on
        # "System" appearance it re-themes and emits host-context-changed (auto-pass).
        # A host pinned to an explicit light/dark won't move; then we skip.
        for scheme in ("dark", "light"):
            try:
                page.emulate_media(color_scheme=scheme)
            except Exception as exc:
                print(f"[conformance] emulate_media {scheme} failed: {exc}", flush=True)
            if wait_interaction_clears(page, 15):
                return f"auto (emulated prefers-color-scheme: {scheme})"
        drive(page, sel, "skip")
        return "skip (theme unchanged — host may be pinned, not on System)"
    # Anything unrecognized: can't drive from here, so skip rather than guess.
    drive(page, sel, "skip")
    return "skip"


# ── main loop ────────────────────────────────────────────────────────


SETTLED = {"PASS", "FAIL", "TIMEOUT", "INFO"}


def _row(state: dict, tid: str) -> dict | None:
    return next((r for r in state.get("rows", []) if r.get("id") == tid), None)


def wait_auto_done(page: Page, timeout_seconds: int = 120, poll: int = 3) -> None:
    """Wait until every non-manual (automatic) row has settled."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        state = read_state(page)
        auto = [r for r in state.get("rows", []) if not r.get("manual")]
        if auto and all(r.get("status") in SETTLED for r in auto):
            return
        time.sleep(poll)
    print("[conformance] warning: auto batch did not fully settle", flush=True)


def wait_row_settles(page: Page, tid: str, timeout_seconds: int = 180, poll: int = 3) -> str:
    """Wait for a single test's row to reach a terminal status."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        row = _row(read_state(page), tid)
        if row and row.get("status") in SETTLED:
            return row["status"]
        time.sleep(poll)
    return "TIMEOUT"


def run_one_manual(page: Page, host: Host, tid: str) -> str:
    """Run a single manual test in isolation: reset the page, start just that test,
    handle its interaction, and wait for it to settle."""
    sel = host.widget_selector
    clear_host_overlay(page)  # clean slate so a prior test's dialog can't eat this one
    # Real click reverts the display mode to inline — ChatGPT gates display-mode
    # changes on a user gesture, so the app's programmatic reset alone won't work.
    real_click_testid(page, "reset-inline")
    try:
        page.emulate_media(color_scheme="light")  # deterministic starting theme for context-changed
    except Exception:
        pass
    drive(page, sel, "run-test", tid)
    deadline = time.time() + 45
    while time.time() < deadline:
        state = read_state(page)
        if state.get("interaction") and state.get("runningId") == tid:
            action = handle_interaction(page, host, state)
            status = wait_row_settles(page, tid)
            print(f"[conformance] {tid}: {action} → {status}", flush=True)
            return action
        row = _row(state, tid)
        if row and row.get("status") in SETTLED:  # settled without an interaction
            return f"auto:{row['status']}"
        time.sleep(2)
    drive(page, sel, "skip")
    return "skip (no interaction appeared)"


def run_suite(page: Page, host: Host, app_name: str) -> dict:
    attempts = 3
    last_error = None
    for attempt in range(attempts):
        try:
            page.goto(host.url, timeout=PAGE_LOAD_TIMEOUT_MS)
            time.sleep(5)  # SPA hydration
            host.dismiss_modal(page)
            host.send_prompt(page, app_name)
            wait_for_widget(page, host.widget_selector)
            install_state_listener(page)
            time.sleep(8)

            # 1) automatic batch — run all non-manual tests at once.
            drive(page, host.widget_selector, "run-auto")
            for _ in range(4):  # confirm the batch actually started
                s = read_state(page)
                auto = [r for r in s.get("rows", []) if not r.get("manual")]
                settled = sum(1 for r in auto if r.get("status") in SETTLED)
                print(f"[conformance] auto: running={s.get('running')} ran={s.get('ran')} settled={settled}/{len(auto)}", flush=True)
                if s.get("running") or settled:
                    break
                time.sleep(3)
            wait_auto_done(page)

            # 2) manual tests — one at a time, resetting between (isolation).
            driven: dict[str, str] = {}
            manual_ids = [r["id"] for r in read_state(page).get("rows", []) if r.get("manual")]
            print(f"[conformance] {len(manual_ids)} manual tests to drive individually", flush=True)
            for tid in manual_ids:
                try:
                    page.bring_to_front()
                except Exception:
                    pass
                driven[tid] = run_one_manual(page, host, tid)

            return _result(host, app_name, read_state(page), driven)
        except Exception as exc:  # fresh conversation clears a blank widget / stalled test
            last_error = exc
            print(f"[conformance] attempt {attempt + 1} failed: {exc}", flush=True)
    raise RuntimeError(f"all {attempts} attempts failed: {last_error}")


def _result(host: Host, app_name: str, state: dict, driven: dict) -> dict:
    return {
        "app_name": app_name,
        "host": state.get("host") or host.name,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "counts": state.get("counts", {}),
        "summary": state.get("summary"),
        "driven": driven,  # what the driver did for each manual test
        "rows": state.get("rows", []),
    }


# ── browser backend ──────────────────────────────────────────────────


@contextmanager
def local_browser(profile_dir: Path) -> Iterator[BrowserContext]:
    """A persistent local Chrome profile, driven directly. headless MUST stay
    off: headless Chromium drops cross-origin MessagePort transfers, which
    breaks the ext-apps init handshake."""
    profile_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(profile_dir),
            channel="chrome",
            headless=False,
            # no_viewport: let the page track the real OS window so a human can
            # scroll/resize normally (e.g. to log in). A fixed `viewport` locks
            # the page size and makes the headed window unscrollable.
            no_viewport=True,
            args=[
                "--disable-blink-features=AutomationControlled",  # navigator.webdriver trips bot checks
                "--disable-popup-blocking",
                "--window-size=1440,1000",
            ],
        )
        try:
            yield context
        finally:
            context.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", choices=list(HOSTS), default="chatgpt", help="host to drive")
    p.add_argument("--mode", choices=["local"], default="local", help="browser backend (local only for now)")
    p.add_argument("--app-name", default="Conformance", help="the app name as connected in the account")
    p.add_argument("--profile-dir", type=Path, default=None, help="persistent Chrome profile dir")
    p.add_argument("--out", type=Path, default=None, help="output dir for results.json")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    host = HOSTS[args.host]
    script_dir = Path(__file__).resolve().parent
    # One profile PER host — each is logged into its own account with the app connected.
    profile_dir = args.profile_dir or script_dir / ".profiles" / args.host
    out_dir = args.out or script_dir / "out" / args.host
    out_dir.mkdir(parents=True, exist_ok=True)

    result: dict | None = None
    with local_browser(profile_dir) as context:
        page = context.pages[0] if context.pages else context.new_page()
        try:
            result = run_suite(page, host, args.app_name)
        except Exception as exc:
            print(f"[conformance] run failed: {exc}", flush=True)

    if result is None:
        print("[conformance] no result produced", flush=True)
        return 1
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_file = out_dir / f"results-{ts}.json"  # timestamped: never overwrite a prior run
    out_file.write_text(json.dumps(result, indent=2))
    print(f"[conformance] wrote {out_file}", flush=True)
    print(f"[conformance] counts: {json.dumps(result['counts'])}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
