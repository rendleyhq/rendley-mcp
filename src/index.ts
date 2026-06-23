import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { otel } from "@hono/otel";
import type { Context } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { config, PROTECTED_RESOURCE_METADATA_PATH } from "@/config";
import { BrowserMode } from "@/constants";
import { requireBearer, type AppEnv } from "@/middlewares/auth";
import { userRateLimit } from "@/rate-limit";
import "@/metrics";
import { registerProjectTools } from "@/tools/projects";
import { registerAccountTools } from "@/tools/account";
import { registerAgentTools } from "@/tools/agent";
import { registerExportTools } from "@/tools/export";
import { registerBrandkitTools } from "@/tools/brandkit";
import { registerUploadTools } from "@/tools/uploads";
import { handleStartAgentJob } from "@/http/agent";
import { handleGetJob } from "@/http/jobs";
import { handleUploadBrandAsset } from "@/http/brandkit";
import { handleStreamUpload } from "@/http/uploads";
import { MAX_UPLOAD_BYTES } from "@/http/upload-tokens";
import { log } from "@/logger";
import { getQueueStats } from "@/queue";
import { installShutdownHandlers } from "@/shutdown";

const app = new Hono<AppEnv>();

// Unwinds last to override secureHeaders' CORP so /.well-known stays cross-origin.
app.use("/.well-known/*", async (c, next) => {
  await next();
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
});

app.use("*", otel());

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: "DENY",
    referrerPolicy: "no-referrer",
  }),
);

app.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  if (
    origin &&
    config.corsOrigins.length > 0 &&
    !config.corsOrigins.includes(origin) &&
    !c.req.path.startsWith("/.well-known/")
  ) {
    return c.json(
      { error: { code: "FORBIDDEN_ORIGIN", message: "Origin not allowed" } },
      403,
    );
  }
  await next();
});

app.use("/.well-known/*", cors({ origin: "*" }));

if (config.corsOrigins.length > 0) {
  app.use(
    "/*",
    cors({
      origin: config.corsOrigins,
      allowMethods: ["POST", "GET", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "mcp-session-id",
        "Mcp-Session-Id",
        "last-event-id",
        "Last-Event-ID",
        "mcp-protocol-version",
        "Mcp-Protocol-Version",
      ],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    }),
  );
}

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    browser_mode: config.browserMode,
  });
});

app.get("/health/details", requireBearer, (c) => {
  return c.json({
    status: "ok",
    browser_mode: config.browserMode,
    ...(config.browserMode === BrowserMode.Remote
      ? { browser_worker_url: config.browserWorkerUrl }
      : {}),
    queue: getQueueStats(),
  });
});

const protectedResourceMetadata = () => ({
  resource: config.mcpResource,
  authorization_servers: [config.authIssuer],
  bearer_methods_supported: ["header"],
  ...(config.oauthScopes.length > 0
    ? { scopes_supported: config.oauthScopes }
    : {}),
});
app.get(PROTECTED_RESOURCE_METADATA_PATH, (c) =>
  c.json(protectedResourceMetadata()),
);
app.get(`${PROTECTED_RESOURCE_METADATA_PATH}/mcp`, (c) =>
  c.json(protectedResourceMetadata()),
);

if (config.openaiAppsChallengeToken) {
  app.get("/.well-known/openai-apps-challenge", (c) =>
    c.text(config.openaiAppsChallengeToken),
  );
}

app.all("/mcp", requireBearer, userRateLimit, (c) => handleMCPRequest(c));

app.post("/v1/agent", requireBearer, userRateLimit, (c) =>
  handleStartAgentJob(c.req.raw, {
    apiClient: c.get("apiClient"),
    apiKey: c.get("apiKey"),
    apiKeyId: c.get("apiKeyId"),
    userId: c.get("userId"),
  }),
);

app.post("/v1/brandkit/assets", requireBearer, userRateLimit, (c) =>
  handleUploadBrandAsset(c.req.raw, { apiClient: c.get("apiClient") }),
);

// The single-use capability token in the path IS the auth, so no requireBearer.
app.put("/v1/uploads/stream/:token", (c) =>
  handleStreamUpload(c.req.raw, c.req.param("token")),
);

app.get("/v1/jobs/:id", requireBearer, userRateLimit, (c) =>
  handleGetJob(c.req.param("id"), c.get("apiKeyId")),
);
app.get("/v1/agent/jobs/:id", requireBearer, userRateLimit, (c) =>
  handleGetJob(c.req.param("id"), c.get("apiKeyId")),
);

function withMcpAccept(req: Request): Request {
  if (req.method !== "POST") {
    return req;
  }
  const accept = req.headers.get("accept") ?? "";
  if (
    accept.includes("application/json") &&
    accept.includes("text/event-stream")
  ) {
    return req;
  }
  const headers = new Headers(req.headers);
  headers.set("accept", "application/json, text/event-stream");
  return new Request(req, { headers });
}

async function handleMCPRequest(c: Context<AppEnv>): Promise<Response> {
  const apiClient = c.get("apiClient");

  const server = new McpServer(
    { name: "Rendley", version: "1.0.0" },
    {
      instructions:
        "Create and edit videos by describing what you want. Connects your assistant to your Rendley projects, media, and brand kit, so it can pull in your own footage, apply your brand colors and assets, and export finished videos.",
    },
  );

  const userId = c.get("userId");

  registerProjectTools(server, apiClient);
  registerAccountTools(server, apiClient);
  registerAgentTools(server, apiClient, userId);
  registerExportTools(server, apiClient);
  registerBrandkitTools(server, apiClient);
  registerUploadTools(server, apiClient);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  return transport.handleRequest(withMcpAccept(c.req.raw));
}

const server = Bun.serve({
  port: config.port,
  idleTimeout: 0,
  maxRequestBodySize: MAX_UPLOAD_BYTES + 8 * 1024 * 1024,
  fetch: app.fetch,
});

installShutdownHandlers({ server });

log.info("mcp_server_started", {
  port: config.port,
  queueConcurrency: config.queueConcurrency,
  browserMode: config.browserMode,
  ...(config.browserMode === BrowserMode.Remote
    ? { browserWorkerUrl: config.browserWorkerUrl }
    : {}),
});
