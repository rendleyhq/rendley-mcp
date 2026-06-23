export function truncate(s: string | null | undefined, max = 280): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return `${n} B`;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "_(none)_";
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const pad = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  const lines: string[] = [];
  lines.push(pad(headers));
  lines.push(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of rows) lines.push(pad(r));
  return "```\n" + lines.join("\n") + "\n```";
}
