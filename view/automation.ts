/**
 * Remote-control protocol for external drivers (the Playwright driver in
 * `notte/conformance.py`) that can't click or read across the host's
 * cross-origin iframes. Modeled on skybridge's `examples/conformance/src/automation.ts`.
 *
 * - Outbound: {@link useStateBroadcast} posts `{type: "conformance:state", state}`
 *   to `window.top`/`window.parent` on every render plus a heartbeat, and mirrors
 *   the latest snapshot onto `window.__conformance` so a driver can also read it
 *   directly via `frame.evaluate` (Playwright reaches any frame, cross-origin or not).
 * - Inbound: the driver posts `{type: "conformance:drive", action}` into the view
 *   window; {@link useDriveListener} dispatches the action.
 *
 * Gesture-gated actions (open-link, download, follow-up message, sampling) must
 * still be driven by a REAL click on the trigger button — postMessage carries no
 * user activation. `run`/`yes`/`no`/`skip` are safe over postMessage.
 */
import { useEffect, useRef } from "react";

export type DriveAction = "run" | "trigger" | "yes" | "no" | "skip";

const DRIVE_MESSAGE = "conformance:drive";
const STATE_MESSAGE = "conformance:state";
const HEARTBEAT_MS = 1500;

declare global {
  interface Window {
    __conformance?: Record<string, unknown>;
  }
}

/** Dispatch inbound `conformance:drive` messages to `onAction` (always the latest). */
export function useDriveListener(onAction: (action: DriveAction) => void): void {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; action?: string } | null;
      if (data?.type === DRIVE_MESSAGE && data.action) {
        onActionRef.current(data.action as DriveAction);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
}

function post(state: Record<string, unknown>): void {
  window.__conformance = state; // direct read path for frame.evaluate
  const message = { type: STATE_MESSAGE, state };
  try {
    window.top?.postMessage(message, "*");
  } catch {
    /* window.top can be inaccessible in exotic sandboxes */
  }
  if (window.parent && window.parent !== window.top) {
    try {
      window.parent.postMessage(message, "*");
    } catch {
      /* same */
    }
  }
}

/** Broadcast `buildState()` on every render plus a {@link HEARTBEAT_MS} heartbeat. */
export function useStateBroadcast(buildState: () => Record<string, unknown>): void {
  const buildStateRef = useRef(buildState);
  buildStateRef.current = buildState;
  // No dependency array: intentionally re-broadcasts after every render.
  useEffect(() => {
    post(buildStateRef.current());
  });
  useEffect(() => {
    const timer = setInterval(() => post(buildStateRef.current()), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);
}
