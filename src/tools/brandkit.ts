import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "@/api/client";
import {
  createUploadToken,
  uploadUrlForToken,
  MAX_UPLOAD_BYTES,
  formatMb,
} from "@/http/upload-tokens";
import { assetTypeFromMime, uploadBrandAssetFromUrl } from "@/brandkit/upload";
import { fail, formatError, outputAny, truncate } from "@/response";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const MAX_FILES = 25;
const MAX_NAME = 256;
const MAX_MIME = 128;

const CATEGORY = z
  .string()
  .max(64)
  .describe(
    "Which brand kit section to file it under (e.g. logos, videos, images, backgrounds, music; see get_brandkit). If omitted, picked from the file type.",
  );

export function registerBrandkitTools(server: McpServer, apiClient: ApiClient) {
  server.registerTool(
    "get_brandkit",
    {
      title: "View brand kit",
      description:
        "List the workspace's brand kit, the saved brand colors and reusable assets such as logos, images, and music. Use it to find brand colors or assets to use in edit_video.",
      inputSchema: {
        workspace_id: z
          .string()
          .regex(ID_RE)
          .optional()
          .describe("Optional workspace; defaults to the first one."),
      },
      outputSchema: outputAny,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspace_id }) => {
      try {
        const wsId = await apiClient.resolveWorkspaceId(workspace_id);
        const [colors, overview] = await Promise.all([
          apiClient.getBrandkitColors(wsId),
          apiClient.getBrandkitOverview(wsId),
        ]);

        const colorLine =
          colors.length > 0
            ? `**Colors:** ${colors.map((c) => c.value).join(", ")}`
            : "**Colors:** none";

        const categoryBlocks = overview.map((category) => {
          const head = `**${category.category_name}** (\`${category.category_id}\`): ${category.assets.length} asset${category.assets.length === 1 ? "" : "s"}`;
          if (category.assets.length === 0) return head;
          return (
            head +
            "\n" +
            category.assets
              .map(
                (a) =>
                  `  - ${truncate(a.original_file_name, 40) || "—"}: ${a.source_url}`,
              )
              .join("\n")
          );
        });

        const text = [
          colorLine,
          "",
          ...categoryBlocks,
          "",
          `Upload categories: ${overview.map((c) => c.category_id).join(", ")}`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            workspace_id: wsId,
            categories: overview.map((c) => c.category_id),
            colors: colors.map((c) => ({ id: c.id, value: c.value })),
            assets_by_category: overview.map((c) => ({
              category_id: c.category_id,
              category_name: c.category_name,
              assets: c.assets.map((a) => ({
                id: a.id,
                name: a.original_file_name,
                mime_type: a.mime_type,
                url: a.source_url,
              })),
            })),
          },
        };
      } catch (err) {
        return fail(`Could not fetch brand kit: ${formatError(err)}`);
      }
    },
  );

  server.registerTool(
    "add_brand_colors",
    {
      title: "Add brand colors",
      description:
        "Add one or more brand colors (hex, e.g. #FF5A1F) to the workspace brand kit. The brand kit is a paid feature; if it isn't available on the user's plan, let them know it requires a paid plan.",
      inputSchema: {
        colors: z
          .array(z.string().regex(HEX_RE))
          .min(1)
          .max(50)
          .describe('Hex colors, e.g. ["#FF5A1F", "#1B1B1B"].'),
        workspace_id: z
          .string()
          .regex(ID_RE)
          .optional()
          .describe("Optional workspace; defaults to the first workspace."),
      },
      outputSchema: outputAny,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ colors, workspace_id }) => {
      try {
        const wsId = await apiClient.resolveWorkspaceId(workspace_id);
        const added = [];
        for (const raw of colors) {
          const value = raw.startsWith("#") ? raw : `#${raw}`;
          added.push(await apiClient.addBrandkitColor(wsId, value));
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Added **${added.length}** color${added.length === 1 ? "" : "s"}: ${added.map((c) => c.value).join(", ")}`,
            },
          ],
          structuredContent: {
            workspace_id: wsId,
            added: added.map((c) => ({ id: c.id, value: c.value })),
          },
        };
      } catch (err) {
        return fail(`Could not add brand colors: ${formatError(err)}`);
      }
    },
  );

  server.registerTool(
    "add_brand_assets",
    {
      title: "Add brand assets",
      description:
        "Add assets to the workspace brand kit from the user's local files or from public links. Files return an upload_url each to PUT the bytes to; links are fetched and added right away. The brand kit is a paid feature; if it isn't available on the user's plan, let them know it requires a paid plan.",
      inputSchema: {
        files: z
          .array(
            z.object({
              name: z.string().min(1).max(MAX_NAME).describe("File name, e.g. logo.png"),
              mime_type: z
                .string()
                .min(1)
                .max(MAX_MIME)
                .describe("File type, e.g. image/png, audio/mpeg, video/mp4"),
              size: z
                .number()
                .int()
                .positive()
                .describe("File size in bytes. Used to reject files over the 100 MB limit before uploading."),
            }),
          )
          .max(MAX_FILES)
          .optional()
          .describe("The user's local files. Each returns an upload_url to PUT its bytes to."),
        links: z
          .array(
            z.object({
              url: z.string().url().max(4096).describe("A public https link to the asset."),
              name: z.string().max(256).optional().describe("Optional display name."),
            }),
          )
          .max(MAX_FILES)
          .optional()
          .describe("Assets already hosted at a public URL. Fetched and added right away."),
        category: CATEGORY.optional(),
        workspace_id: z
          .string()
          .regex(ID_RE)
          .optional()
          .describe("Optional workspace; defaults to the first one."),
      },
      outputSchema: outputAny,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ files, links, category, workspace_id }) => {
      if (!files?.length && !links?.length) {
        return fail("Provide files (the user's local files) or links (public URLs) to add to the brand kit.");
      }
      try {
        const wsId = await apiClient.resolveWorkspaceId(workspace_id);

        const addedLinks: string[] = [];
        const linkErrors: string[] = [];
        for (const link of links ?? []) {
          try {
            const result = await uploadBrandAssetFromUrl(apiClient, {
              url: link.url,
              name: link.name,
              category,
              workspaceId: wsId,
            });
            addedLinks.push(result.name);
          } catch (err) {
            linkErrors.push(`${link.name ?? link.url}: ${formatError(err)}`);
          }
        }

        const oversized = (files ?? []).filter((f) => f.size > MAX_UPLOAD_BYTES);
        const uploads = (files ?? [])
          .filter((f) => f.size <= MAX_UPLOAD_BYTES)
          .map((file) => {
            const token = createUploadToken({
              kind: "brandkit",
              apiClient,
              workspaceId: wsId,
              assetType: category ?? assetTypeFromMime(file.mime_type),
              mimeType: file.mime_type,
              fileName: file.name,
            });
            return { name: file.name, mime_type: file.mime_type, upload_url: uploadUrlForToken(token) };
          });
        const rejected = oversized.map((f) => ({
          name: f.name,
          size: f.size,
          reason: `${formatMb(f.size)}, over the ${formatMb(MAX_UPLOAD_BYTES)} limit`,
        }));

        if (addedLinks.length === 0 && uploads.length === 0) {
          const why = [
            rejected.length
              ? `over the ${formatMb(MAX_UPLOAD_BYTES)} limit: ${rejected.map((r) => `${r.name} (${formatMb(r.size)})`).join(", ")}`
              : "",
            linkErrors.join("; "),
          ]
            .filter(Boolean)
            .join(". ");
          return fail(`No assets were added. ${why}`.trim());
        }

        const lines: string[] = [];
        if (addedLinks.length > 0) {
          lines.push(
            `Added **${addedLinks.length}** asset${addedLinks.length === 1 ? "" : "s"} from links: ${addedLinks.join(", ")}.`,
          );
        }
        if (uploads.length > 0) {
          lines.push(
            "",
            "For EACH file below: PUT its raw bytes to `upload_url` with header `Content-Type: <mime_type>`. On success the asset is added to the brand kit. No completion call is needed.",
            "",
            "```json",
            JSON.stringify(uploads, null, 2),
            "```",
          );
        }
        if (rejected.length > 0) {
          lines.push(
            "",
            `These files are over the ${formatMb(MAX_UPLOAD_BYTES)} limit and were NOT uploaded: ` +
              `${rejected.map((r) => `${r.name} (${formatMb(r.size)})`).join(", ")}. ` +
              "Tell the user to add them in the editor directly, or pass a public link here.",
          );
        }
        if (linkErrors.length > 0) {
          lines.push(
            "",
            `Could not add ${linkErrors.length} link${linkErrors.length === 1 ? "" : "s"}: ${linkErrors.join("; ")}`,
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n").trim() }],
          structuredContent: {
            workspace_id: wsId,
            added_from_links: addedLinks,
            uploads,
            rejected,
            link_errors: linkErrors,
          },
        };
      } catch (err) {
        return fail(`Could not add brand assets: ${formatError(err)}`);
      }
    },
  );
}
