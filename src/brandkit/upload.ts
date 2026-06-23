import { basename } from "path";
import type { ApiClient } from "@/api/client";
import { safeFetchMedia } from "@/utils/url-guard";

const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const ASSET_FETCH_TIMEOUT_MS = 30_000;

// asset_type must match dashboard section IDs or the asset uploads but never renders.
export function assetTypeFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith("video/")) return "videos";
  if (m.startsWith("audio/")) return "music";
  return "images";
}

export interface UploadBrandAssetResult {
  workspaceId: string;
  uploadId: string;
  name: string;
  mimeType: string;
}

export async function uploadBrandAssetFromUrl(
  apiClient: ApiClient,
  input: { url: string; name?: string; workspaceId?: string; category?: string },
): Promise<UploadBrandAssetResult> {
  const workspaceId = await apiClient.resolveWorkspaceId(input.workspaceId);

  const fetched = await safeFetchMedia(input.url, {
    maxBytes: MAX_ASSET_BYTES,
    timeoutMs: ASSET_FETCH_TIMEOUT_MS,
  });
  const mimeType =
    fetched.contentType.split(";")[0].trim() || "application/octet-stream";
  const name =
    input.name?.trim() || basename(new URL(input.url).pathname) || "asset";

  const created = await apiClient.createBrandkitUpload(workspaceId, {
    assetType: input.category ?? assetTypeFromMime(mimeType),
    mimeType,
    fileSize: fetched.size,
    originalFileName: name,
  });

  const put = await fetch(created.presigned_url, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    // Buffer is a valid fetch body at runtime; cast around lib type mismatch.
    body: fetched.body as unknown as BodyInit,
  });
  if (!put.ok) {
    throw new Error(`storage_put_failed:${put.status}`);
  }

  await apiClient.completeBrandkitUpload(workspaceId, created.upload_id);

  return { workspaceId, uploadId: created.upload_id, name, mimeType };
}
