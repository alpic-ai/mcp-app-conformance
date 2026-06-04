import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "./server.js";

const RESULTS_HISTORY = resolve(process.cwd(), "results/history.jsonl");
const DASHBOARD_DIR = resolve(process.cwd(), "dashboard");

async function startHttp(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const app = express();

  app.use(express.json());

  app.get("/results", (_req: Request, res: Response) => {
    if (!existsSync(RESULTS_HISTORY)) return res.json([]);
    const runs = readFileSync(RESULTS_HISTORY, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .reverse();
    res.json(runs);
  });

  app.use("/", express.static(DASHBOARD_DIR));

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[conformance] MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.listen(port, () => {
    console.error(`[conformance] MCP server on http://localhost:${port}/mcp`);
  });
}

async function startStdio(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

const main = process.argv.includes("--stdio") ? startStdio : startHttp;
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
