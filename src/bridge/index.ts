import type { Page } from "playwright";
import type {
  BridgeAttachment,
  BridgeMessage,
  BridgeStatus,
  FlushSaveResult,
} from "@/types/bridge.types";

export type {
  BridgeAttachment,
  BridgeMessage,
  BridgeStatus,
  FlushSaveResult,
};

export const bridge = {
  async getStatus(page: Page): Promise<BridgeStatus | null> {
    return (await page.evaluate(() => window.__rendleyAgent?.getStatus() ?? null)) as
      | BridgeStatus
      | null;
  },

  async getMessages(page: Page): Promise<BridgeMessage[]> {
    return (await page.evaluate(
      () => window.__rendleyAgent?.getMessages() ?? [],
    )) as BridgeMessage[];
  },

  async sendMessage(
    page: Page,
    message: string,
    attachments?: BridgeAttachment[],
  ): Promise<void> {
    await page.evaluate(
      async ({ msg, atts }) => {
        await window.__rendleyAgent?.sendMessage(msg, atts);
      },
      { msg: message, atts: attachments },
    );
  },

  async resumeInterrupt(page: Page, response: "approve" | "reject"): Promise<void> {
    await page.evaluate(async (res) => {
      await window.__rendleyAgent?.resumeInterrupt(res);
    }, response);
  },

  async ensureSaved(page: Page, timeoutMs = 60000): Promise<FlushSaveResult> {
    return (await page.evaluate(
      async (ms) =>
        (await window.__rendleyAgent?.ensureSaved(ms)) ?? { status: "error" as const },
      timeoutMs,
    )) as FlushSaveResult;
  },

  lastAssistantContent(messages: BridgeMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].content ?? "";
    }
    return "";
  },
};
