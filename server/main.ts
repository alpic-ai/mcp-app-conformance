#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { createServer } from "./server.js";

async function startHttp(): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const app = express();

  app.use(express.json());

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
