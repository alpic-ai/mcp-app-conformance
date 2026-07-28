import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostImplementation, Status, SubtestResult } from "../../shared/protocol";

export interface ResultsFile {
  host: string;
  appName: string;
  hostInfo?: HostImplementation | null;
  capturedAt: string;
  counts: Record<Status, number>;
  results: SubtestResult[];
}

export function buildResults(
  host: string,
  appName: string,
  results: SubtestResult[],
  hostInfo?: HostImplementation | null,
): ResultsFile {
  const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, SKIP: 0, NOTRUN: 0 } as Record<Status, number>;
  for (const r of results) counts[r.status]++;
  return { host, appName, hostInfo: hostInfo ?? null, capturedAt: new Date().toISOString(), counts, results };
}

/** Never overwrites — one timestamped file per run (matches the Python driver). */
export function writeResults(outDir: string, data: ResultsFile): string {
  mkdirSync(outDir, { recursive: true });
  const ts = data.capturedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
  const path = join(outDir, `results-${ts}.json`);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

/**
 * Playwright records one .webm per page, so a test that opens a tab leaves extra
 * short clips. Keep the largest (the main session), drop the rest.
 */
export function finalizeVideo(videoTmpDir: string, recordingsDir: string, host: string): string | null {
  if (!existsSync(videoTmpDir)) return null;
  const webms = readdirSync(videoTmpDir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => join(videoTmpDir, f));
  if (webms.length === 0) {
    rmSync(videoTmpDir, { recursive: true, force: true });
    return null;
  }
  const largest = webms.reduce((a, b) => (statSync(a).size >= statSync(b).size ? a : b));
  mkdirSync(recordingsDir, { recursive: true });
  const dest = join(recordingsDir, `${host}.webm`);
  renameSync(largest, dest);
  rmSync(videoTmpDir, { recursive: true, force: true });
  return dest;
}
