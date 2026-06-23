// The token IS the auth (presigned-URL model): the upload endpoint has no bearer check.
import { randomBytes } from "node:crypto";
import { config } from "@/config";
import type { ApiClient } from "@/api/client";

export interface ProjectUploadContext {
  kind: "project";
  apiClient: ApiClient;
  projectId: string;
  mediaId: string;
  mimeType: string;
  fileName: string;
}

export interface BrandkitUploadContext {
  kind: "brandkit";
  apiClient: ApiClient;
  workspaceId: string;
  assetType: string;
  mimeType: string;
  fileName: string;
}

export type UploadContext = ProjectUploadContext | BrandkitUploadContext;

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const formatMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

const TTL_MS = 30 * 60 * 1000;

const store = new Map<string, { ctx: UploadContext; expires: number }>();

function purgeExpired(now: number): void {
  for (const [token, entry] of store) {
    if (entry.expires <= now) store.delete(token);
  }
}

setInterval(() => purgeExpired(Date.now()), 5 * 60 * 1000).unref?.();

export const uploadUrlForToken = (token: string) =>
  `${config.mcpPublicUrl}/v1/uploads/stream/${token}`;

export function createUploadToken(ctx: UploadContext): string {
  const now = Date.now();
  purgeExpired(now);
  const token = randomBytes(32).toString("hex");
  store.set(token, { ctx, expires: now + TTL_MS });
  return token;
}

// Single-use: delete on first lookup regardless of expiry.
export function consumeUploadToken(token: string): UploadContext | null {
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token);
  if (entry.expires <= Date.now()) return null;
  return entry.ctx;
}
