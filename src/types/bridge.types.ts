export interface BridgeAttachment {
  media_id?: string;
  storage_url?: string;
  name?: string;
}

export interface BridgeMessage {
  role: "user" | "assistant" | "system";
  content: string;
  error?: string;
}

export interface BridgeStatus {
  isStreaming: boolean;
  hasInterrupt: boolean;
  interruptType: BridgeInterruptType | null;
  interruptId: string | null;
  messageCount: number;
  isSyncing: boolean;
  commandExecutions: number;
  lastError?: string | null;
}

export type BridgeInterruptType =
  | "plan_review"
  | "request_upgrade"
  | "tool_review"
  | "context_request"
  | "command_execution";

export interface BridgeExportConfig {
  codec?: "h264" | "h265" | "vp9" | "vp8";
  targetResolution?: "720p" | "1080p" | "4K";
  quality?: "high" | "medium" | "low";
  bitrate?: number;
}

export interface BridgeExportResult {
  status: "ok" | "empty" | "error";
  size?: number;
  mimeType?: string;
  extension?: string;
  storageUrl?: string;
  fileHash?: string;
  mediaId?: string;
  uploadId?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  error?: string;
  errorCode?: string;
}

export type FlushSaveResult = { status: "synced" | "timeout" | "error" };

export interface RendleyAgentWindowApi {
  sendMessage: (
    message: string,
    attachments?: BridgeAttachment[],
  ) => Promise<void>;
  getStatus: () => BridgeStatus;
  getMessages: () => BridgeMessage[];
  resumeInterrupt: (response: "approve" | "reject") => Promise<void>;
  ensureSaved: (timeoutMs?: number) => Promise<FlushSaveResult>;
  exportProject: (config?: BridgeExportConfig) => Promise<BridgeExportResult>;
}

declare global {
  interface Window {
    __rendleyAgent?: RendleyAgentWindowApi;
    __rendleyEditorReady?: boolean;
  }
}
