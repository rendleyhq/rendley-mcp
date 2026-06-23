export interface ToolTextResponse {
  // Required by MCP SDK's RegisteredTool signature.
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
