import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "@/api/client";
import { config, headlessProjectUrl, projectUrl } from "@/config";
import { isQueueFull, QueueFullError, tryRunQueued } from "@/queue";
import { fail, formatError, outputAny, truncate } from "@/response";
import type { PollOutcome } from "@/types/agent.types";
import { getAgentBrowser } from "@/sdk/browser-factory";
import { BrowserBusyError } from "@/sdk/remote-browser";
import type { RunAgentInput } from "@/sdk/agent-browser";
import { acquireAll, releaseAll, resolveKeys } from "@/concurrency-limits";
import { resolvePlanCap } from "@/plan-cache";
import { validateExternalUrl } from "@/utils/url-guard";
import { recordConcurrencyRejected, recordQueueFullRejected } from "@/metrics";
import { log } from "@/logger";
import { progressFromExtra } from "@/mcp/progress";
import type { BridgeAttachment } from "@/types/bridge.types";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_MESSAGE_CHARS = 20_000;
const MAX_FILES = 100;

function formatOutcome(
  outcome: PollOutcome,
  projectId: string,
  maxWaitMs: number,
  threadId: string | null,
) {
  const url = projectUrl(projectId);
  const structuredContent = {
    project_id: projectId,
    project_url: url,
    ...(threadId ? { thread_id: threadId } : {}),
  };

  switch (outcome.kind) {
    case "interrupt":
      return {
        content: [
          {
            type: "text" as const,
            text:
              "⛔ This isn't available on the user's current plan.\n\n" +
              `> ${truncate(outcome.lastMessage || "(no message)", 400)}\n\n` +
              "Let the user know this requires a paid plan.\n\n" +
              `Open project: ${url}`,
          },
          {
            type: "resource_link" as const,
            uri: url,
            name: "Open project",
            mimeType: "text/html",
            description: "Open the Rendley project in the editor",
          },
        ],
        structuredContent: {
          ...structuredContent,
          status: "needs_upgrade",
          interrupt_type: outcome.status.interruptType,
        },
      };

    case "save_failed":
      return {
        content: [
          {
            type: "text" as const,
            text:
              `⚠️ Save not confirmed (status: ${outcome.saveStatus})\n\n` +
              `> ${truncate(outcome.lastMessage || "Agent completed", 400)}\n\n` +
              "Call `edit_video` again to retry. Multi-turn resume is not supported in this build.\n\n" +
              `Open project: ${url}`,
          },
          {
            type: "resource_link" as const,
            uri: url,
            name: "Open project",
            mimeType: "text/html",
            description: "Open the Rendley project in the editor",
          },
        ],
        structuredContent: {
          ...structuredContent,
          status: "save_failed",
          save_status: outcome.saveStatus,
        },
      };

    case "timeout":
      return {
        content: [
          {
            type: "text" as const,
            text:
              `⏱ Agent still working after ${Math.round(maxWaitMs / 1000)}s — the edit may still be processing in the background.\n\n` +
              `> ${truncate(outcome.lastMessage || "(no message)", 400)}\n\n` +
              "Check the project shortly, or retry with a smaller scope. Very long edits can be run via the async /v1/agent API.\n\n" +
              `Open project: ${url}`,
          },
          {
            type: "resource_link" as const,
            uri: url,
            name: "Open project",
            mimeType: "text/html",
            description: "Open the Rendley project in the editor",
          },
        ],
        structuredContent: {
          ...structuredContent,
          status: "in_progress",
        },
      };

    case "error":
      return {
        content: [
          {
            type: "text" as const,
            text:
              `⚠️ The agent couldn't complete this request: ${truncate(outcome.error, 400)}\n\n` +
              (outcome.status.commandExecutions > 0
                ? `${outcome.status.commandExecutions} command${outcome.status.commandExecutions === 1 ? "" : "s"} were applied before it stopped (saved).\n\n`
                : "No changes were made to the timeline.\n\n") +
              `Open project: ${url}`,
          },
          {
            type: "resource_link" as const,
            uri: url,
            name: "Open project",
            mimeType: "text/html",
            description: "Open the Rendley project in the editor",
          },
        ],
        structuredContent: {
          ...structuredContent,
          status: "error",
          error: outcome.error,
          command_executions: outcome.status.commandExecutions,
        },
      };

    case "completed": {
      const cmdCount = outcome.status.commandExecutions ?? 0;
      if (cmdCount === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "⚠️ Agent finished without executing any editor commands. The timeline is unchanged.\n\n" +
                `> ${truncate(outcome.lastMessage || "(no message)", 400)}\n\n` +
                'Retry with more explicit instructions (for example: *"Use the editor tools to add three text clips on layer 0 at 0s, 3s, 6s"*).\n\n' +
                `Open project: ${url}`,
            },
            {
              type: "resource_link" as const,
              uri: url,
              name: "Open project",
              mimeType: "text/html",
              description: "Open the Rendley project in the editor",
            },
          ],
          structuredContent: {
            ...structuredContent,
            status: "completed",
            command_executions: cmdCount,
          },
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text:
              `✅ Agent completed. ${cmdCount} command${cmdCount === 1 ? "" : "s"} applied, saved.\n\n` +
              `> ${truncate(outcome.lastMessage || "(no message)", 400)}\n\n` +
              `Open project: ${url}`,
          },
          {
            type: "resource_link" as const,
            uri: url,
            name: "Open project",
            mimeType: "text/html",
            description: "Open the Rendley project in the editor",
          },
        ],
        structuredContent: {
          ...structuredContent,
          status: "completed",
          command_executions: cmdCount,
        },
      };
    }
  }
}

export function registerAgentTools(
  server: McpServer,
  apiClient: ApiClient,
  userId: string,
) {
  server.registerTool(
    "edit_video",
    {
      title: "Edit video",
      description:
        "Create or edit a video through text, using the user's own footage or letting Rendley supply it. Use it for any video creation or editing task.",
      inputSchema: {
        project_id: z.string().regex(ID_RE).describe("Project to work on"),
        message: z
          .string()
          .min(1)
          .max(MAX_MESSAGE_CHARS)
          .describe(
            "Complete instructions for the video. Be specific about what you want. The editor handles searching, generating, and editing.",
          ),
        files: z
          .array(
            z.object({
              url: z
                .string()
                .url()
                .max(4096)
                .describe(
                  "A public https link to the media. Local file paths aren't supported.",
                ),
              media_id: z
                .string()
                .regex(ID_RE)
                .optional()
                .describe(
                  "Optional. When you added the file with add_files, pass back the id it returned so the same file is reused.",
                ),
              name: z
                .string()
                .max(256)
                .optional()
                .describe("Optional display name."),
            }),
          )
          .max(MAX_FILES)
          .optional()
          .describe(
            "The user's media to bring into the project first. Use public https links, or for their own local files add them with add_files and pass back what it returns.",
          ),
        continue_conversation: z
          .boolean()
          .optional()
          .describe(
            "Resume this project's most recent agent conversation so prior context carries over. Defaults to starting a new conversation. Ignored when thread_id is given.",
          ),
        thread_id: z
          .string()
          .regex(ID_RE)
          .optional()
          .describe(
            "Advanced: continue a specific earlier conversation by the id a prior edit_video returned. Usually unnecessary; omit to start fresh, or set continue_conversation to resume the latest.",
          ),
        end_user_id: z
          .string()
          .regex(ID_RE)
          .optional()
          .describe(
            "Optional. Identifies the downstream end user on whose behalf this edit runs, so per-user concurrency limits apply. Omit for single-user keys.",
          ),
      },
      outputSchema: outputAny,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async (
      { project_id, message, files, thread_id, continue_conversation, end_user_id },
      extra,
    ) => {
      const logger = log.child({
        projectId: project_id,
        tool: "edit_video",
      });

      if (isQueueFull()) {
        recordQueueFullRejected();
        logger.warn("queue_full_edit_video_rejected");
        return fail(
          "The video editor is at capacity right now. Please retry in a few seconds.",
        );
      }

      const planCap = await resolvePlanCap(userId, apiClient);
      const { tenantKey, endUserKey } = resolveKeys(userId, end_user_id);
      const reqs = [{ key: tenantKey, max: planCap }];
      if (endUserKey !== tenantKey) {
        reqs.push({ key: endUserKey, max: config.maxConcurrentPerEndUser });
      }
      const acquiredKeys = reqs.map((r) => r.key);
      if (!acquireAll(reqs)) {
        recordConcurrencyRejected();
        logger.warn("concurrency_limit_exceeded");
        return fail(
          "You have too many edits running right now. Please wait for one to finish and retry.",
        );
      }

      try {
        return await tryRunQueued(async () => {
        const progress = progressFromExtra(extra);
        try {
          let resolvedThreadId: string | null = thread_id ?? null;
          if (!resolvedThreadId && continue_conversation) {
            resolvedThreadId = await apiClient.getLastAgentThread(project_id);
          }

          const remoteAttachments: BridgeAttachment[] = (files ?? []).map(
            (file) => ({
              storage_url: file.url,
              ...(file.media_id ? { media_id: file.media_id } : {}),
              ...(file.name?.trim() ? { name: file.name.trim() } : {}),
            }),
          );

          for (const attachment of remoteAttachments) {
            if (attachment.storage_url) {
              validateExternalUrl(attachment.storage_url);
            }
          }

          const sessionToken = await apiClient.getEditorSessionToken(project_id);
          const headlessUrl = headlessProjectUrl(
            project_id,
            sessionToken,
            resolvedThreadId ?? undefined,
          );

          const input: RunAgentInput = {
            headlessUrl,
            projectId: project_id,
            message,
            attachments:
              remoteAttachments.length > 0 ? remoteAttachments : undefined,
            threadId: resolvedThreadId,
            maxWaitMs: config.syncAgentTimeoutMs,
          };

          const outcome = await getAgentBrowser().runAgent(
            input,
            progress,
            extra.signal,
          );

          if (!resolvedThreadId) {
            resolvedThreadId = await apiClient.getLastAgentThread(project_id);
          }

          return formatOutcome(
            outcome,
            project_id,
            config.syncAgentTimeoutMs,
            resolvedThreadId,
          );
        } catch (err) {
          if (err instanceof BrowserBusyError) {
            logger.warn("browser_busy", { err });
            const hint = err.retryAfterSeconds
              ? ` Please retry in ${err.retryAfterSeconds} seconds.`
              : " Please retry in a few seconds.";
            return fail(
              `The video editor is at capacity right now.${hint}`,
            );
          }
          if (err instanceof QueueFullError) {
            recordQueueFullRejected();
            logger.warn("queue_full", { err });
            return fail(
              "The video editor is at capacity right now. Please retry in a few seconds.",
            );
          }
          logger.error("send_failed", { err });
          return fail(`Agent message failed: ${formatError(err)}`);
        }
        }, extra.signal);
      } catch (err) {
        if (err instanceof QueueFullError) {
          recordQueueFullRejected();
          logger.warn("queue_full", { err });
          return fail(
            "The video editor is at capacity right now. Please retry in a few seconds.",
          );
        }
        throw err;
      } finally {
        releaseAll(acquiredKeys);
      }
    },
  );
}
