/**
 * The reference conformance test server.
 *
 * Exposes one ui:// test page (the conformance runner) plus the tools the
 * harness needs: a model-visible launcher, an app-only probe to prove tool
 * proxying (HST-06), and an app-only results collector. Any MCP Apps host can
 * be pointed at this server's /mcp endpoint and run the suite.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const RUNNER_URI = "ui://conformance/runner";
const VIEW_HTML = resolve(process.cwd(), "dist/view/index.html");
const RESULTS_DIR = resolve(process.cwd(), "results");

function loadRunnerHtml(): string {
  if (existsSync(VIEW_HTML)) return readFileSync(VIEW_HTML, "utf-8");
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px">
    <h2>Runner not built</h2><p>Run <code>npm run build:view</code> first.</p></body></html>`;
}

function persistResults(payload: unknown): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const line = JSON.stringify(payload);
  writeFileSync(resolve(RESULTS_DIR, "latest.json"), line, "utf-8");
  appendFileSync(resolve(RESULTS_DIR, "history.jsonl"), line + "\n", "utf-8");
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-apps-conformance-server",
    version: "0.1.0",
  });

  registerAppResource(
    server,
    "Conformance Runner",
    RUNNER_URI,
    { description: "Runs the MCP Apps conformance suite inside the host." },
    () => ({
      contents: [
        {
          uri: RUNNER_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadRunnerHtml(),
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "run_conformance",
    {
      description: "Run the MCP Apps conformance test suite against this host.",
      _meta: { ui: { resourceUri: RUNNER_URI, visibility: ["model", "app"] } },
    },
    (): CallToolResult => ({
      content: [{ type: "text", text: "Launching the MCP Apps conformance runner…" }],
    }),
  );

  registerAppTool(
    server,
    "conformance_probe",
    {
      description: "Echo probe used by the conformance harness to verify tool proxying.",
      inputSchema: { ping: z.string() },
      _meta: { ui: { visibility: ["app"] } },
    },
    ({ ping }): CallToolResult => ({
      content: [{ type: "text", text: `echo:${ping}` }],
    }),
  );

  // Model-only fixture tool (NOT app-visible). The visibility test calls this
  // from the view; a conformant host MUST reject that call.
  registerAppTool(
    server,
    "model_only_probe",
    {
      description: "Model-only fixture; an app calling this MUST be rejected by the host.",
      inputSchema: { ping: z.string() },
      _meta: { ui: { visibility: ["model"] } },
    },
    ({ ping }): CallToolResult => ({
      content: [{ type: "text", text: `model-only:${ping}` }],
    }),
  );

  registerAppTool(
    server,
    "report_results",
    {
      description: "Receives conformance results from the runner View.",
      inputSchema: {
        host: z.string(),
        hostVersion: z.string().optional(),
        specVersion: z.string(),
        results: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            status: z.enum(["PASS", "FAIL", "TIMEOUT", "NOTRUN"]),
            tag: z.enum(["core", "host-specific"]).optional(),
            vantage: z.enum(["in-view", "server", "agent", "transport", "manual"]).optional(),
            clause: z.enum(["MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", "REQUIRED"]).optional(),
            caveat: z.string().optional(),
            message: z.string().optional(),
            durationMs: z.number().optional(),
          }),
        ),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    (args): CallToolResult => {
      const payload = { ...args, receivedAt: new Date().toISOString() };
      persistResults(payload);
      const pass = args.results.filter((r) => r.status === "PASS").length;
      console.error(`[conformance] ${args.host}: ${pass}/${args.results.length} passing`);
      return { content: [{ type: "text", text: `stored ${args.results.length} results for ${args.host}` }] };
    },
  );

  return server;
}
