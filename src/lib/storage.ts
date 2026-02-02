// src/lib/storage.ts
import type { Sestina } from "./sestine";

export type GroupEvent =
  | { type: "generate"; at: string; count: number; seed?: string; constraintsSnapshot: any }
  | { type: "validate"; at: string; draw: number[]; jolly?: number; superstar?: number };

export type Group = {
  id: string;
  name: string;
  createdAt: string;
  sestine: Sestina[];
  events: GroupEvent[];
};

export type Settings = {
  seedEnabled: boolean;
  seedValue: string;

  // evidenziazioni
  highlightEvenOdd: boolean;
  highlightLowHigh: boolean;

  // vincoli
  exclude: number[];
  mustInclude: number[];
  mustIncludeAnyOf: number[];

  // superstizione
  superstitionEnabled: boolean;
  luckyNumbers: number[];
  unluckyNumbers: number[];
  birthDate?: string; // YYYY-MM-DD

  // etica
  showOddsBanner: boolean;
};

export type AppState = {
  version: 2;
  groups: Group[];
  settings: Settings;
};

const STORAGE_KEY = "superenalotto:sestine:v2";

export function defaultState(): AppState {
  return {
    version: 2,
    groups: [],
    settings: {
      seedEnabled: false,
      seedValue: "PASQUA2026",
      highlightEvenOdd: true,
      highlightLowHigh: true,

      exclude: [],
      mustInclude: [],
      mustIncludeAnyOf: [],

      superstitionEnabled: false,
      luckyNumbers: [],
      unluckyNumbers: [],
      birthDate: undefined,

      showOddsBanner: true,
    },
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || parsed.version !== 2) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function newId(prefix = "g"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
