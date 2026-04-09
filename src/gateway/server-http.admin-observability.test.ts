import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedGatewayAuth } from "./auth.js";
import { createGatewayHttpServer } from "./server-http.js";
import type { GatewayWsClient } from "./server/ws-types.js";

async function requestJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
      },
      (res) => {
        let payload = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          payload += chunk;
        });
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(payload || "{}"),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("gateway http admin observability routes", () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
  });

  it("serves replay diagnostics on /admin/api/replay", async () => {
    const clients = new Set<GatewayWsClient>();
    const resolvedAuth: ResolvedGatewayAuth = { mode: "none", allowTailscale: false };
    const server = createGatewayHttpServer({
      canvasHost: null,
      clients,
      controlUiEnabled: false,
      controlUiBasePath: "/__control__",
      openAiChatCompletionsEnabled: false,
      openResponsesEnabled: false,
      handleHooksRequest: async () => false,
      resolvedAuth,
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await requestJson(port, "/admin/api/replay?traceId=test-trace-1");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          traceId: "test-trace-1",
          events: expect.any(Array),
        }),
      }),
    );
  });

  it("returns 400 when replay request omits traceId/sessionId", async () => {
    const clients = new Set<GatewayWsClient>();
    const resolvedAuth: ResolvedGatewayAuth = { mode: "none", allowTailscale: false };
    const server = createGatewayHttpServer({
      canvasHost: null,
      clients,
      controlUiEnabled: false,
      controlUiBasePath: "/__control__",
      openAiChatCompletionsEnabled: false,
      openResponsesEnabled: false,
      handleHooksRequest: async () => false,
      resolvedAuth,
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await requestJson(port, "/admin/api/replay");
    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({ success: false }));
  });
});
