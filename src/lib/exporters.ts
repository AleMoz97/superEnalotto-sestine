// src/lib/exporters.ts
import type { AppState } from "./storage";

export function toCSV(state: AppState): string {
  const header = [
    "groupId", "groupName", "groupCreatedAt",
    "indexInGroup", "sestinaKey",
    "n1", "n2", "n3", "n4", "n5", "n6",
    "frozen", "createdAt", "seed", "attemptNonce", "superstitionMode"
  ].join(",");

  const lines: string[] = [header];

  for (const g of state.groups) {
    g.sestine.forEach((s, idx) => {
      const row = [
        esc(g.id), esc(g.name), esc(g.createdAt),
        String(idx + 1), esc(s.key),
        ...s.nums.map(String),
        String(s.frozen),
        esc(s.createdAt),
        esc(s.meta?.seed ?? ""),
        String(s.meta?.attemptNonce ?? ""),
        String(!!s.meta?.superstitionMode),
      ].join(",");
      lines.push(row);
    });
  }

  return lines.join("\n");
}

function esc(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function toTXT(state: AppState) {
  const lines: string[] = [];
  const ts = new Date().toLocaleString();

  lines.push(`SuperEnalotto — Sestine`);
  lines.push(`Export: ${ts}`);
  lines.push("");

  for (const g of state.groups) {
    lines.push(`Gruppo: ${g.name} (${g.sestine.length})`);
    g.sestine.forEach((s, i) => {
      lines.push(`${i + 1}) ${s.nums.join(" ")}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}


export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
