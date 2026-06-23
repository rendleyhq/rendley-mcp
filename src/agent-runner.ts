import { ApiClient } from "@/api/client";
import { config, headlessProjectUrl } from "@/config";
import { getAgentBrowser } from "@/sdk/browser-factory";
import { BrowserBusyError } from "@/sdk/remote-browser";
import { updateJob } from "@/jobs/index";
import { log } from "@/logger";
import type { BridgeAttachment } from "@/types/bridge.types";
import { JobStatus } from "@/types/jobs.types";

interface RunInput {
  jobId: string;
  apiKey: string;
  apiKeyId: string;
  projectId: string;
  prompt: string;
  attachments: BridgeAttachment[];
  maxWaitMs?: number;
  threadId: string;
}

export async function runAgentJob(input: RunInput): Promise<void> {
  const maxWaitMs = input.maxWaitMs ?? config.agentTimeoutMs;
  const logger = log.child({
    jobId: input.jobId,
    projectId: input.projectId,
    component: "agentRunner",
  });

  try {
    logger.info("start", { attachments: input.attachments.length });

    await updateJob(input.jobId, { status: JobStatus.Running });

    const sessionToken = await new ApiClient({
      baseUrl: config.apiBaseUrl,
      apiKey: input.apiKey,
    }).getEditorSessionToken(input.projectId);
    const headlessUrl = headlessProjectUrl(
      input.projectId,
      sessionToken,
      input.threadId,
    );

    const outcome = await getAgentBrowser().runAgent({
      headlessUrl,
      projectId: input.projectId,
      message: input.prompt,
      attachments: input.attachments,
      threadId: input.threadId,
      maxWaitMs,
    }, () => {});

    switch (outcome.kind) {
      case "completed":
        await updateJob(input.jobId, {
          status: JobStatus.Completed,
          last_message: outcome.lastMessage,
          result: {
            project_id: input.projectId,
            project_url: `${config.appBaseUrl}/editor/${input.projectId}`,
            commands_applied: outcome.status.commandExecutions,
            saved: true,
            thread_id: input.threadId,
          },
        });
        break;

      case "save_failed":
        await updateJob(input.jobId, {
          status: JobStatus.Failed,
          last_message: outcome.lastMessage,
          error: `save not confirmed: ${outcome.saveStatus}`,
          result: {
            reason: "save_not_confirmed",
            save_status: outcome.saveStatus,
            thread_id: input.threadId,
          },
        });
        break;

      case "timeout":
        await updateJob(input.jobId, {
          status: JobStatus.Failed,
          last_message: outcome.lastMessage,
          error: `agent exceeded ${maxWaitMs}ms timeout`,
          result: {
            reason: "timeout",
            timeout_ms: maxWaitMs,
            thread_id: input.threadId,
          },
        });
        break;

      case "error":
        await updateJob(input.jobId, {
          status: JobStatus.Failed,
          last_message: outcome.lastMessage,
          error: outcome.error,
          result: {
            reason: "agent_error",
            command_executions: outcome.status.commandExecutions,
            thread_id: input.threadId,
          },
        });
        break;

      case "interrupt":
        await updateJob(input.jobId, {
          status: JobStatus.Failed,
          last_message: outcome.lastMessage,
          error: `unexpected interrupt: ${outcome.status.interruptType ?? "unknown"}`,
          result: {
            reason: "unexpected_interrupt",
            interrupt_type: outcome.status.interruptType ?? null,
            thread_id: input.threadId,
          },
        });
        break;
    }
  } catch (err) {
    if (err instanceof BrowserBusyError) {
      logger.warn("browser_busy", { err });
      await updateJob(input.jobId, {
        status: JobStatus.Failed,
        error: "browser worker at capacity",
        result: {
          reason: "at_capacity",
          ...(err.retryAfterSeconds
            ? { retry_after_seconds: err.retryAfterSeconds }
            : {}),
        },
      });
      return;
    }
    logger.error("failed", { err });
    await updateJob(input.jobId, {
      status: JobStatus.Failed,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
