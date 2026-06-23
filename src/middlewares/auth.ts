import type { Context, MiddlewareHandler } from "hono";
import { ApiClient } from "@/api/client";
import { config, protectedResourceMetadataUrl } from "@/config";
import { log } from "@/logger";

export type AppEnv = {
  Variables: {
    apiKey: string;
    apiClient: ApiClient;
    apiKeyId: string;
    userId: string;
  };
};

function unauthorized(c: Context<AppEnv>, message: string) {
  const scope =
    config.oauthScopes.length > 0 ? ` scope="${config.oauthScopes.join(" ")}"` : "";
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${protectedResourceMetadataUrl()}"${scope}`,
  );
  return c.json({ error: { code: "UNAUTHORIZED", message } }, 401);
}

export const requireBearer: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization");
  if (header && !header.startsWith("Bearer ")) {
    return unauthorized(c, "Invalid Authorization header. Expected Bearer <token>");
  }
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!bearer) {
    return unauthorized(
      c,
      "Authentication required. Send an API key as Authorization: Bearer <key>, or follow the WWW-Authenticate header to sign in via OAuth.",
    );
  }

  // Verifier outage (not invalid_api_key) must fall through to OAuth, not 502 yet.
  let verified = null;
  let apiKeyUnavailable = false;
  try {
    verified = await ApiClient.verifyApiKey(config.apiBaseUrl, bearer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== "invalid_api_key") {
      log.error("verify_api_key_failed", { err });
      apiKeyUnavailable = true;
    }
  }
  if (verified) {
    c.set("apiKey", bearer);
    c.set("apiClient", new ApiClient({ baseUrl: config.apiBaseUrl, apiKey: bearer }));
    c.set("apiKeyId", verified.keyId);
    c.set("userId", verified.userId);
    return next();
  }

  // Not a valid API key; try it as an OAuth access token.
  let oauth = null;
  let oauthUnavailable = false;
  try {
    oauth = await ApiClient.verifyMcpToken(config.authBaseUrl, bearer);
  } catch (err) {
    log.error("verify_oauth_token_failed", { err });
    oauthUnavailable = true;
  }
  if (oauth) {
    c.set("apiKey", bearer);
    c.set("apiClient", new ApiClient({ baseUrl: config.apiBaseUrl, apiKey: bearer }));
    c.set("apiKeyId", `oauth:${oauth.userId}`);
    c.set("userId", oauth.userId);
    return next();
  }
  if (oauthUnavailable && apiKeyUnavailable) {
    return c.json(
      { error: { code: "AUTH_UNAVAILABLE", message: "Could not validate credentials" } },
      502,
    );
  }

  return unauthorized(c, "Invalid credentials");
};
