import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type ProgressFn = (message: string, total?: number) => Promise<void>;

export function progressFromExtra(extra: Extra | undefined): ProgressFn {
  const token = extra?._meta?.progressToken;
  if (!extra || token === undefined) return async () => {};

  let counter = 0;
  return async (message, total) => {
    counter += 1;
    try {
      await extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress: counter,
          total,
          message,
        },
      });
    } catch {}
  };
}
