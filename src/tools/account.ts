import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "@/api/client";
import { bytes, fail, formatError, outputAny } from "@/response";

export function registerAccountTools(server: McpServer, apiClient: ApiClient) {
  server.registerTool(
    "get_account",
    {
      title: "Account & plan",
      description:
        "Returns an overview of the user's account. Reports their plan and its status, credit balance, how much storage they have used and how much remains, how many projects, workspaces, and transcription minutes they have used against their limits, and whether they have access to the Brand Kit.",
      inputSchema: {},
      outputSchema: outputAny,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const me = await apiClient.getMe();
        const sub = me.subscription ?? null;
        const usage = me.usage ?? null;

        const limit = (n: number) =>
          n === -1 ? "unlimited" : n.toLocaleString();

        const storageUsed = usage?.storage_used ?? 0;
        const storageLimit = sub?.storage_bytes ?? null;
        const storageUnlimited = storageLimit === -1;
        const storageLeft =
          storageLimit !== null && !storageUnlimited
            ? Math.max(0, storageLimit - storageUsed)
            : null;

        const lines: string[] = [];
        if (sub) {
          const interval = sub.billing_interval
            ? `, ${sub.billing_interval}`
            : "";
          lines.push(`**Plan:** ${sub.plan_name} (${sub.status}${interval})`);
        } else {
          lines.push("**Plan:** Free (no active subscription)");
        }
        lines.push(`**Credits:** ${me.credits.balance.toLocaleString()}`);
        if (storageLimit === null) {
          lines.push(`**Storage used:** ${bytes(storageUsed)}`);
        } else if (storageUnlimited) {
          lines.push(`**Storage:** ${bytes(storageUsed)} used (unlimited)`);
        } else {
          lines.push(
            `**Storage:** ${bytes(storageUsed)} of ${bytes(storageLimit)} used (${bytes(storageLeft ?? 0)} left)`,
          );
        }
        if (sub) {
          const transcription =
            sub.transcription_seconds === -1
              ? "unlimited"
              : `${sub.transcription_seconds}s`;
          lines.push(
            `**Projects:** ${usage?.projects_used ?? 0} of ${limit(sub.projects)} used`,
          );
          lines.push(
            `**Workspaces:** ${usage?.workspaces_used ?? 0} of ${limit(sub.workspaces)} used`,
          );
          lines.push(
            `**Transcription:** ${usage?.transcription_seconds_used ?? 0}s of ${transcription} used`,
          );
          lines.push(
            `**Brand kit:** ${sub.brandkit ? "included" : "not in plan"}`,
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          structuredContent: {
            credits: me.credits.balance,
            subscription: sub
              ? {
                  plan_name: sub.plan_name,
                  status: sub.status,
                  billing_interval: sub.billing_interval,
                  brandkit: sub.brandkit,
                  limits: {
                    projects: sub.projects,
                    workspaces: sub.workspaces,
                    storage_bytes: sub.storage_bytes,
                    transcription_seconds: sub.transcription_seconds,
                  },
                }
              : null,
            usage: {
              projects_used: usage?.projects_used ?? 0,
              workspaces_used: usage?.workspaces_used ?? 0,
              storage_used: storageUsed,
              storage_left: storageLeft,
              transcription_seconds_used:
                usage?.transcription_seconds_used ?? 0,
            },
          },
        };
      } catch (err) {
        return fail(`Could not fetch account details: ${formatError(err)}`);
      }
    },
  );
}
