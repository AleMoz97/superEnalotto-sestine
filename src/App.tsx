// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { List, type RowComponentProps } from "react-window";
import {
  loadState,
  saveState,
  newId,
  defaultState,
  type AppState,
  type Group,
} from "./lib/storage";
import { toCSV, downloadTextFile, toTXT } from "./lib/exporters";
import { frequencyMap, topNumbers, missingNumbers } from "./lib/stats";
import { rngFromSeed, mulberry32 } from "./lib/rng";
import { generateUniqueSestine, type Constraints } from "./lib/sestine";

type Tab = "generate" | "stats" | "validate" | "settings";

type ValidationRow = {
  key: string;
  nums: number[];
  hits: number;
  hitNums: number[];
  frozen: boolean;
  jollyHit: boolean;
  superstarHit: boolean;
};

type ValidationResult = {
  at: string;
  groupId: string;
  groupName: string;
  draw: number[];
  jolly?: number;
  superstar?: number;
  counts: Record<number, number>;
  rows: ValidationRow[];
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function clampNumList(values: string): number[] {
  const parts = values.split(/[^0-9]+/g).filter(Boolean);
  const nums = parts
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 90);
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function parseSixUnique(
  input: string,
): { ok: true; nums: number[] } | { ok: false; error: string } {
  const nums = clampNumList(input);
  if (nums.length !== 6) {
    return {
      ok: false,
      error: `Devi inserire ESATTAMENTE 6 numeri unici (1–90). Ora: ${nums.length}.`,
    };
  }
  return { ok: true, nums };
}

function parseOptionalOne(input: string): number | undefined {
  const nums = clampNumList(input);
  if (nums.length === 0) return undefined;
  return nums[0];
}

function oddsText() {
  return "Probabilità di fare 6: 1 su 622.614.630 (circa). Generare numeri non aumenta le probabilità.";
}

function nCk(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res = (res * (n - (k - i))) / i;
  }
  return res;
}

function singleTicketExactMatchProb(r: number): number {
  // Probabilità che una sestina random abbia ESATTAMENTE r match con una estrazione (6 numeri su 90)
  // p_r = C(6,r) * C(84, 6-r) / C(90,6)
  const total = nCk(90, 6);
  return (nCk(6, r) * nCk(84, 6 - r)) / total;
}

/*function bestResultDistribution(kTickets: number): { m: number; p: number }[] {
  // Distribuzione teorica del "miglior risultato" (max match) tra k sestine.
  // Assunzione: sestine ~ indipendenti (con unicità globale è una buona approssimazione).
  const pExact = Array.from({ length: 7 }, (_, r) =>
    singleTicketExactMatchProb(r),
  ); // 0..6
  const cdf = Array(7).fill(0);
  let acc = 0;
  for (let r = 0; r <= 6; r++) {
    acc += pExact[r];
    cdf[r] = acc; // P(X<=r)
  }

  const dist: { m: number; p: number }[] = [];
  for (let m = 0; m <= 6; m++) {
    const a = m === 0 ? 0 : Math.pow(cdf[m - 1], kTickets); // P(max <= m-1)
    const b = Math.pow(cdf[m], kTickets); // P(max <= m)
    dist.push({ m, p: Math.max(0, b - a) });
  }
  // vogliamo 6..0 per grafico
  return dist.sort((x, y) => y.m - x.m);
}*/

function atLeastDistribution(kTickets: number): { m: number; p: number }[] {
  // pExact[r] e cdf[r] come prima
  const pExact = Array.from({ length: 7 }, (_, r) =>
    singleTicketExactMatchProb(r),
  ); // 0..6

  const cdf = Array(7).fill(0);
  let acc = 0;
  for (let r = 0; r <= 6; r++) {
    acc += pExact[r];
    cdf[r] = acc; // P(X <= r)
  }

  // P(max >= m) = 1 - P(max <= m-1) = 1 - (P(X <= m-1))^k
  const out: { m: number; p: number }[] = [];
  for (let m = 1; m <= 6; m++) {
    out.push({ m, p: 1 - Math.pow(cdf[m - 1], kTickets) });
  }

  return out.sort((a, b) => b.m - a.m); // 6..1
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function birthDateToLucky(date?: string): number[] {
  if (!date) return [];
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const arr = [
    d,
    mo,
    y % 100,
    (d + mo) % 90 || 90,
    (d + (y % 100)) % 90 || 90,
  ].map((n) => ((n - 1) % 90) + 1);
  return Array.from(new Set(arr)).sort((a, b) => a - b);
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-full text-sm font-extrabold border transition select-none",
        active
          ? "bg-blue-50 border-blue-200 text-blue-900"
          : "bg-white border-black/10 text-black/80 hover:bg-black/[0.03]",
      )}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const isDisabled = disabled || loading;
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        "px-3 py-2 rounded-xl border font-extrabold transition inline-flex items-center gap-2 justify-center",
        isDisabled
          ? "border-black/10 bg-black/5 text-black/40 cursor-not-allowed"
          : "border-black/10 bg-black text-white hover:bg-black/90",
        className,
      )}
    >
      {loading && (
        <span className="h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
      )}
      <span>{children}</span>
    </button>
  );
}

function Button({
  children,
  onClick,
  disabled,
  loading,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "default" | "danger";
  className?: string;
}) {
  const isDisabled = disabled || loading;
  const base =
    "px-3 py-2 rounded-xl border font-extrabold transition select-none inline-flex items-center gap-2 justify-center";
  const styles =
    variant === "danger"
      ? isDisabled
        ? "border-red-200 bg-red-50 text-red-300 cursor-not-allowed"
        : "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
      : isDisabled
        ? "border-black/10 bg-black/5 text-black/40 cursor-not-allowed"
        : "border-black/10 bg-white text-black/80 hover:bg-black/[0.03]";

  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={cn(base, styles, className)}
    >
      {loading && (
        <span
          className={cn(
            "h-4 w-4 rounded-full border-2 animate-spin",
            variant === "danger"
              ? "border-red-500/50 border-t-transparent"
              : "border-black/30 border-t-transparent",
          )}
        />
      )}
      <span>{children}</span>
    </button>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  className,
}: {
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      onChange={onChange}
      placeholder={placeholder}
      className={cn(
        "w-full px-3 py-2 rounded-xl border border-black/10 bg-white outline-none",
        "focus:ring-2 focus:ring-blue-200 focus:border-blue-200",
        disabled && "bg-black/5 text-black/40 cursor-not-allowed",
        className,
      )}
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 select-none",
        disabled && "opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-blue-600"
      />
      <span className="text-sm font-bold text-black/80">{label}</span>
    </label>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="h-2 rounded-full bg-black/10 overflow-hidden">
      <div className="h-full bg-blue-500/50" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Chip({
  n,
  isHit,
  evenOdd,
  lowHigh,
}: {
  n: number;
  isHit?: boolean;
  evenOdd: boolean;
  lowHigh: boolean;
}) {
  const isEven = n % 2 === 0;
  const isLow = n <= 45;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[34px] h-8 px-3 rounded-full border text-sm font-black",
        "transition",
        isHit
          ? "bg-green-500/10 border-green-500/30"
          : "bg-white border-black/10",
        evenOdd &&
          (isEven ? "ring-1 ring-cyan-500/10" : "ring-1 ring-orange-500/10"),
        lowHigh && (isLow ? "" : "border-blue-500/20"),
        !isHit && "text-black/85",
      )}
      title={`${n}`}
    >
      {n}
    </span>
  );
}

function SestineVirtualList({
  items,
  evenOdd,
  lowHigh,
  onToggleFreeze,
  onRemove,
  isBusy,
}: {
  items: Array<{
    key: string;
    nums: number[];
    frozen: boolean;
    createdAt: string;
    meta?: { seed?: string };
  }>;
  evenOdd: boolean;
  lowHigh: boolean;
  onToggleFreeze: (key: string) => void;
  onRemove: (key: string) => void;
  isBusy: boolean;
}) {
  const ROW_H = 92;

  type RowProps = {
    items: typeof items;
    evenOdd: boolean;
    lowHigh: boolean;
    onToggleFreeze: (key: string) => void;
    onRemove: (key: string) => void;
    isBusy: boolean;
  };

  const rowProps: RowProps = useMemo(
    () => ({
      items,
      evenOdd,
      lowHigh,
      onToggleFreeze,
      onRemove,
      isBusy,
    }),
    [items, evenOdd, lowHigh, onToggleFreeze, onRemove, isBusy],
  );

  const Row = ({ index, style, ...rp }: RowComponentProps<RowProps>) => {
    const s = rp.items[index];

    return (
      <div style={style as React.CSSProperties} className="px-3 py-2">
        <div
          className={cn(
            "rounded-2xl border p-3 flex items-start justify-between gap-3",
            s.frozen
              ? "bg-blue-50 border-blue-200"
              : "bg-white border-black/10",
          )}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              {s.nums.map((n) => (
                <Chip key={n} n={n} evenOdd={rp.evenOdd} lowHigh={rp.lowHigh} />
              ))}
            </div>

            <div className="mt-2 text-xs text-black/55 font-mono break-all">
              key: {s.key} · {new Date(s.createdAt).toLocaleString()}
              {s.meta?.seed ? ` · seed:${s.meta.seed}` : ""}
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            <Button
              onClick={() => rp.onToggleFreeze(s.key)}
              disabled={rp.isBusy}
              className="px-3"
            >
              {s.frozen ? "🔓" : "🔒"}
            </Button>
            <Button
              variant="danger"
              onClick={() => rp.onRemove(s.key)}
              disabled={rp.isBusy}
              className="px-3"
            >
              ✕
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <List
      rowCount={items.length}
      rowHeight={ROW_H}
      rowComponent={Row}
      rowProps={rowProps}
      overscanCount={6}
      style={{ height: 620, width: "100%" }}
    />
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>("generate");

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    () => state.groups[0]?.id ?? null,
  );

  const [newGroupName, setNewGroupName] = useState("Gruppo 1");
  const [countToGenerate, setCountToGenerate] = useState<number>(5);

  // validator inputs
  const [drawInput, setDrawInput] = useState("1 2 3 4 5 6");
  const [jollyInput, setJollyInput] = useState("");
  const [superstarInput, setSuperstarInput] = useState("");

  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genModal, setGenModal] = useState<null | {
    groupName: string;
    total: number;
    done: number;
  }>(null);
  // Pagination UI
  const [pageSize, setPageSize] = useState<number>(200);
  const [pageIndex, setPageIndex] = useState<number>(0);

  const genAbortRef = React.useRef(false);

  useEffect(() => {
    // Debounce: localStorage è sincrono e con dataset grandi freeza.
    // Inoltre non salvare mentre stai generando.
    if (isGenerating) return;

    const t = setTimeout(() => {
      saveState(state);
    }, 800);

    return () => clearTimeout(t);
  }, [state, isGenerating]);

  useEffect(() => {
    if (selectedGroupId && state.groups.some((g) => g.id === selectedGroupId))
      return;
    setSelectedGroupId(state.groups[0]?.id ?? null);
  }, [state.groups, selectedGroupId]);

  useEffect(() => {
    // quando cambio gruppo, riparto dalla prima pagina
    setPageIndex(0);
  }, [selectedGroupId]);

  const selectedGroup = useMemo(
    () => state.groups.find((g) => g.id === selectedGroupId) ?? null,
    [state.groups, selectedGroupId],
  );
  // ---- Pagination derived values (solo gruppo selezionato) ----
  const selectedCount = selectedGroup?.sestine.length ?? 0;

  const pageCount = useMemo(() => {
    if (selectedCount === 0) return 1;
    return Math.max(1, Math.ceil(selectedCount / pageSize));
  }, [selectedCount, pageSize]);

  // clamp pageIndex se cambia la size o cambia la lunghezza
  useEffect(() => {
    setPageIndex((p) => Math.min(p, pageCount - 1));
  }, [pageCount]);

  const pageStart = pageIndex * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, selectedCount);

  const pageSestine = useMemo(() => {
    if (!selectedGroup) return [];
    return selectedGroup.sestine.slice(pageStart, pageEnd);
  }, [selectedGroup, pageStart, pageEnd]);

  const totalSestine = useMemo(
    () => state.groups.reduce((acc, g) => acc + g.sestine.length, 0),
    [state.groups],
  );

  const globalKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of state.groups) for (const s of g.sestine) keys.add(s.key);
    return keys;
  }, [state.groups]);

  const constraints = useMemo<Constraints>(() => {
    const s = state.settings;

    const birthLucky = s.superstitionEnabled
      ? birthDateToLucky(s.birthDate)
      : [];
    const lucky = s.superstitionEnabled
      ? Array.from(new Set([...s.luckyNumbers, ...birthLucky]))
      : [];
    const unlucky = s.superstitionEnabled ? s.unluckyNumbers : [];

    const exclude = Array.from(new Set([...s.exclude, ...unlucky])).sort(
      (a, b) => a - b,
    );
    const mustInclude = s.mustInclude;
    const mustIncludeAnyOf = Array.from(
      new Set([...s.mustIncludeAnyOf, ...(lucky.length ? lucky : [])]),
    ).sort((a, b) => a - b);

    return { exclude, mustInclude, mustIncludeAnyOf };
  }, [state.settings]);

  // ===== Actions
  function addGroup() {
    const name = newGroupName.trim() || `Gruppo ${state.groups.length + 1}`;
    const g: Group = {
      id: newId("group"),
      name,
      createdAt: new Date().toISOString(),
      sestine: [],
      events: [],
    };
    setState((prev) => ({ ...prev, groups: [g, ...prev.groups] }));
    setSelectedGroupId(g.id);
  }

  function renameGroup(groupId: string, name: string) {
    const newName = name.trim();
    if (!newName) return;
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, name: newName } : g,
      ),
    }));
  }

  function deleteGroup(groupId: string) {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== groupId),
    }));
  }

  function clearGroup(groupId: string) {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, sestine: [], events: g.events } : g,
      ),
    }));
  }

  function toggleFreeze(groupId: string, key: string) {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => {
        if (g.id !== groupId) return g;
        return {
          ...g,
          sestine: g.sestine.map((s) =>
            s.key === key ? { ...s, frozen: !s.frozen } : s,
          ),
        };
      }),
    }));
  }

  function removeSestina(groupId: string, key: string) {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId
          ? { ...g, sestine: g.sestine.filter((s) => s.key !== key) }
          : g,
      ),
    }));
  }

  async function generateForSelectedGroup() {
    if (!selectedGroup) return;

    const n = Math.max(1, Math.floor(countToGenerate || 1));
    const keys = new Set(globalKeys);

    const seedEnabled = state.settings.seedEnabled;
    const seed = seedEnabled ? state.settings.seedValue.trim() : "";

    // base seed per random non deterministico
    const baseRng = seedEnabled
      ? rngFromSeed(`${seed}::${selectedGroup.id}::base`)
      : mulberry32(crypto.getRandomValues(new Uint32Array(1))[0] >>> 0);

    const baseSeedNum = Math.floor(baseRng() * 2 ** 32) >>> 0;

    // chunked generation config
    const CHUNK = n >= 5000 ? 250 : n >= 1000 ? 200 : n >= 200 ? 100 : 50;

    setIsGenerating(true);
    setGenModal({ groupName: selectedGroup.name, total: n, done: 0 });
    genAbortRef.current = false;

    try {
      let produced = 0;
      let nonceBase = 0;
      const allGenerated: any[] = [];

      while (produced < n) {
        if (genAbortRef.current) break;

        const take = Math.min(CHUNK, n - produced);

        const rngFactory = (nonce: number) => {
          const nn = nonceBase + nonce;
          if (seedEnabled)
            return rngFromSeed(
              `${seed}::${selectedGroup.id}::${totalSestine}::${nn}`,
            );
          return mulberry32((baseSeedNum + nn * 1013904223) >>> 0);
        };

        const chunk = generateUniqueSestine(
          take,
          keys,
          rngFactory,
          constraints,
          {
            seed: seedEnabled ? seed : undefined,
            superstitionMode: state.settings.superstitionEnabled,
          },
        );

        allGenerated.push(...chunk);
        produced += chunk.length;
        nonceBase += take * 3; // sposta lo spazio nonce per evitare collisioni "seedate"
        setGenModal({
          groupName: selectedGroup.name,
          total: n,
          done: produced,
        });

        // yield al browser: evita freeze e “script long running”
        await sleep(0);
      }

      if (!genAbortRef.current) {
        setState((prev) => ({
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== selectedGroup.id) return g;
            const event = {
              type: "generate" as const,
              at: new Date().toISOString(),
              count: n,
              seed: seedEnabled ? seed : undefined,
              constraintsSnapshot: constraints,
            };
            return {
              ...g,
              sestine: [...allGenerated, ...g.sestine],
              events: [event, ...g.events],
            };
          }),
        }));
      }
    } catch (e: any) {
      // vincoli impossibili / troppi duplicati / ecc.
      alert(e?.message ?? "Errore durante la generazione.");
    } finally {
      setIsGenerating(false);
      setGenModal(null);
      genAbortRef.current = false;
    }
  }

  function regenerateNonFrozenInGroup(groupId: string) {
    const g = state.groups.find((x) => x.id === groupId);
    if (!g) return;

    const frozen = g.sestine.filter((s) => s.frozen);
    const toRegenCount = g.sestine.length - frozen.length;
    if (toRegenCount <= 0) return;

    const keys = new Set(globalKeys);
    for (const s of g.sestine) if (!s.frozen) keys.delete(s.key);

    const seedEnabled = state.settings.seedEnabled;
    const seed = seedEnabled ? state.settings.seedValue.trim() : "";

    const rngFactory = (nonce: number) =>
      seedEnabled
        ? rngFromSeed(`${seed}::${g.id}::regen::${nonce}`)
        : mulberry32(
            (crypto.getRandomValues(new Uint32Array(1))[0] + nonce) >>> 0,
          );

    const regenerated = generateUniqueSestine(
      toRegenCount,
      keys,
      rngFactory,
      constraints,
      {
        seed: seedEnabled ? seed : undefined,
        superstitionMode: state.settings.superstitionEnabled,
      },
    );

    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((x) => {
        if (x.id !== g.id) return x;
        const event = {
          type: "generate" as const,
          at: new Date().toISOString(),
          count: toRegenCount,
          seed: seedEnabled ? seed : undefined,
          constraintsSnapshot: constraints,
        };
        return {
          ...x,
          sestine: [...frozen, ...regenerated],
          events: [event, ...x.events],
        };
      }),
    }));
  }

  function exportCSV() {
    const csv = toCSV(state);
    const ts = new Date().toISOString().replaceAll(":", "-");
    downloadTextFile(`sestine_${ts}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportJSON() {
    const ts = new Date().toISOString().replaceAll(":", "-");
    downloadTextFile(
      `sestine_${ts}.json`,
      JSON.stringify(state, null, 2),
      "application/json",
    );
  }

  function resetAll() {
    setState(defaultState());
    setSelectedGroupId(null);
  }

  // ===== Stats (sul gruppo selezionato)
  const groupBestDist = useMemo(() => {
    const k = selectedGroup?.sestine.length ?? 0;
    if (k <= 0) return null;
    return atLeastDistribution(k);
  }, [selectedGroup?.sestine.length]);

  const statsScopeSestine = useMemo(
    () => selectedGroup?.sestine ?? [],
    [selectedGroup],
  );
  const freq = useMemo(
    () => frequencyMap(statsScopeSestine),
    [statsScopeSestine],
  );
  const top10 = useMemo(() => topNumbers(freq, 10), [freq]);
  const missing = useMemo(() => missingNumbers(freq), [freq]);
  const maxFreq = useMemo(() => Math.max(0, ...freq), [freq]);

  // ===== Validation
  function validateAgainstGroup() {
    if (!selectedGroup) return;
    setValidationError(null);

    const parsed = parseSixUnique(drawInput);
    if (!parsed.ok) {
      setValidationError(parsed.error);
      return;
    }

    const draw = parsed.nums;
    const jolly = parseOptionalOne(jollyInput);
    const superstar = parseOptionalOne(superstarInput);

    const drawSet = new Set(draw);

    const rows: ValidationRow[] = selectedGroup.sestine.map((s) => {
      const hitNums = s.nums.filter((n) => drawSet.has(n));
      const hits = hitNums.length;
      return {
        key: s.key,
        nums: s.nums,
        hits,
        hitNums,
        frozen: s.frozen,
        jollyHit: jolly ? s.nums.includes(jolly) : false,
        superstarHit: superstar ? s.nums.includes(superstar) : false,
      };
    });

    const counts: Record<number, number> = {
      0: 0,
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    };
    for (const r of rows) counts[r.hits] = (counts[r.hits] ?? 0) + 1;

    rows.sort(
      (a, b) =>
        b.hits - a.hits ||
        Number(b.frozen) - Number(a.frozen) ||
        a.key.localeCompare(b.key),
    );

    const res: ValidationResult = {
      at: new Date().toISOString(),
      groupId: selectedGroup.id,
      groupName: selectedGroup.name,
      draw,
      jolly,
      superstar,
      counts,
      rows,
    };

    setValidationResult(res);

    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => {
        if (g.id !== selectedGroup.id) return g;
        const ev = {
          type: "validate" as const,
          at: res.at,
          draw,
          jolly,
          superstar,
        };
        return { ...g, events: [ev, ...g.events] };
      }),
    }));
  }

  const evenOdd = state.settings.highlightEvenOdd;
  const lowHigh = state.settings.highlightLowHigh;

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* HEADER centrato */}
        <header className="flex flex-col items-center text-center gap-3">
          <div className="flex flex-col items-center gap-1">
            <div className="relative">
              <h1
                className={[
                  "text-4xl sm:text-5xl font-black tracking-tight",
                  "[font-family:'Bungee',system-ui]",
                  "text-transparent bg-clip-text",
                  "bg-gradient-to-r from-green-700 via-emerald-500 to-green-700",
                  "drop-shadow-[0_1px_0_rgba(0,0,0,0.15)]",
                  "animate-titlePulse",
                ].join(" ")}
              >
                SuperEnalotto — Sestine
              </h1>

              <div
                className={[
                  "absolute inset-0 -z-10 blur-2xl opacity-50",
                  "bg-gradient-to-r from-green-500/50 via-emerald-400/40 to-green-500/50",
                  "animate-titleGlow",
                ].join(" ")}
              />

              <div
                className={[
                  "pointer-events-none absolute inset-y-0 left-0 w-20",
                  "bg-gradient-to-r from-transparent via-white/40 to-transparent",
                  "skew-x-12 opacity-40",
                  "animate-titleShine",
                ].join(" ")}
              />
            </div>

            <div className="flex flex-wrap justify-center gap-3 text-sm text-black/70">
              <span>
                Gruppi: <b className="text-black">{state.groups.length}</b>
              </span>
              <span>
                Totale sestine: <b className="text-black">{totalSestine}</b>
              </span>
              <span>
                Unicità globale: <b className="text-black">✅</b>
              </span>
            </div>
          </div>

          {/* TABS sotto il titolo */}
          <div className="inline-flex flex-wrap justify-center gap-2 p-2 rounded-full border border-black/10 bg-white shadow-sm">
            <TabButton
              active={tab === "generate"}
              onClick={() => setTab("generate")}
            >
              🎲 Genera
            </TabButton>
            <TabButton active={tab === "stats"} onClick={() => setTab("stats")}>
              📊 Stats
            </TabButton>
            <TabButton
              active={tab === "validate"}
              onClick={() => setTab("validate")}
            >
              ✅ Valida
            </TabButton>
            <TabButton
              active={tab === "settings"}
              onClick={() => setTab("settings")}
            >
              ⚙️ Impostazioni
            </TabButton>
          </div>
        </header>

        {/* BANNER */}
        {state.settings.showOddsBanner && (
          <div className="mt-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-2xl border border-black/10 bg-yellow-50 px-4 py-3 shadow-sm">
            <div className="text-sm text-black/80">{oddsText()}</div>
            <Button
              onClick={() =>
                setState((p) => ({
                  ...p,
                  settings: { ...p.settings, showOddsBanner: false },
                }))
              }
              className="self-start md:self-auto"
            >
              Nascondi
            </Button>
          </div>
        )}

        {/* GRID */}
        <main className="mt-5 grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 items-start">
          {/* SIDEBAR */}
          <section className="rounded-2xl border border-black/10 bg-white shadow-sm p-4">
            <h2 className="text-lg font-extrabold">Gruppi</h2>

            <div className="mt-3 flex gap-2">
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Nome gruppo"
              />
              <PrimaryButton onClick={addGroup}>Crea</PrimaryButton>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              {state.groups.length === 0 ? (
                <p className="text-sm text-black/60">
                  Nessun gruppo. Creane uno.
                </p>
              ) : (
                state.groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGroupId(g.id)}
                    className={cn(
                      "text-left p-3 rounded-2xl border transition",
                      g.id === selectedGroupId
                        ? "bg-blue-50 border-blue-200"
                        : "bg-white border-black/10 hover:bg-black/[0.03]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold">{g.name}</span>
                      <span className="text-xs font-black px-2 py-0.5 rounded-full bg-black/5 border border-black/10">
                        {g.sestine.length}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-black/60">
                      {new Date(g.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="my-4 h-px bg-black/10" />

            <h3 className="text-sm font-extrabold text-black/80">Export</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={exportCSV} disabled={totalSestine === 0}>
                Scarica CSV
              </Button>
              <Button onClick={exportJSON} disabled={state.groups.length === 0}>
                Scarica JSON
              </Button>
              <Button
                disabled={state.groups.length === 0}
                onClick={() => {
                  const txt = toTXT(state);
                  const ts = new Date().toISOString().replaceAll(":", "-");
                  downloadTextFile(
                    `sestine_${ts}.txt`,
                    txt,
                    "text/plain;charset=utf-8",
                  );
                }}
              >
                Scarica TXT
              </Button>
            </div>

            <div className="mt-3">
              <Button
                onClick={resetAll}
                disabled={state.groups.length === 0}
                variant="danger"
                className="w-full"
              >
                Reset totale
              </Button>
            </div>
          </section>

          {/* CONTENT */}
          <section className="rounded-2xl border border-black/10 bg-white shadow-sm p-4">
            {!selectedGroup ? (
              <p className="text-sm text-black/60">
                Seleziona o crea un gruppo.
              </p>
            ) : tab === "generate" ? (
              <>
                <div className="flex flex-col gap-2">
                  <h2 className="text-lg font-extrabold">Generazione</h2>
                  <div className="text-xs text-black/60">
                    Vincoli: exclude={constraints.exclude.length}, mustInclude=
                    {constraints.mustInclude.length}, anyOf=
                    {constraints.mustIncludeAnyOf.length}
                    {state.settings.seedEnabled
                      ? ` · seed="${state.settings.seedValue.trim()}"`
                      : " · seed OFF"}
                    {state.settings.superstitionEnabled
                      ? " · superstizione ON"
                      : ""}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
                  <Input
                    value={selectedGroup.name}
                    onChange={() => {}}
                    placeholder="Nome gruppo"
                    className="hidden"
                  />
                  <input
                    defaultValue={selectedGroup.name}
                    onBlur={(e) =>
                      renameGroup(selectedGroup.id, e.target.value)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-black/10 bg-white outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-200"
                  />
                  <Button
                    variant="danger"
                    onClick={() => deleteGroup(selectedGroup.id)}
                  >
                    Elimina gruppo
                  </Button>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-[140px_auto_auto_auto] gap-2 items-center">
                  <Input
                    type="number"
                    value={String(countToGenerate)}
                    onChange={(e) => setCountToGenerate(Number(e.target.value))}
                    placeholder="N"
                  />
                  <PrimaryButton
                    onClick={generateForSelectedGroup}
                    loading={isGenerating}
                  >
                    Genera
                  </PrimaryButton>
                  <Button
                    onClick={() => regenerateNonFrozenInGroup(selectedGroup.id)}
                    disabled={selectedGroup.sestine.length === 0}
                    loading={isGenerating}
                  >
                    Rigenera NON bloccate
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => clearGroup(selectedGroup.id)}
                    disabled={
                      isGenerating || selectedGroup.sestine.length === 0
                    }
                  >
                    Svuota gruppo
                  </Button>
                </div>

                {selectedGroup.sestine.length > 0 && groupBestDist && (
                  <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-sm font-extrabold text-black/80">
                        Probabilità teoriche (miglior risultato su{" "}
                        {selectedGroup.sestine.length} sestine)
                      </div>
                      <div className="text-xs text-black/60">
                        modello: sestine random ~ indipendenti
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-3">
                      {groupBestDist.map(({ m, p }) => {
                        const pct = p * 100;
                        return (
                          <div
                            key={m}
                            className="grid grid-cols-[80px_1fr_80px] gap-3 items-center"
                          >
                            <div className="text-sm font-black text-black/80">
                              {m} / 6
                            </div>
                            <div className="h-2 rounded-full bg-black/10 overflow-hidden">
                              <div
                                className="h-full bg-blue-500/60"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <div className="text-sm font-bold text-black/70 text-right">
                              {pct.toFixed(pct < 0.01 ? 4 : pct < 0.1 ? 3 : 2)}%
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 text-xs text-black/60">
                      Interpretazione: probabilità che, su una singola
                      estrazione, il tuo miglior biglietto tra i{" "}
                      {selectedGroup.sestine.length} faccia esattamente quel
                      risultato.
                    </div>
                  </div>
                )}

                {/* LISTA + PAGINAZIONE + VIRTUALIZZAZIONE */}
                <div className="mt-4">
                  {selectedGroup.sestine.length === 0 ? (
                    <div className="text-sm text-black/60">
                      Nessuna sestina in questo gruppo.
                    </div>
                  ) : (
                    <>
                      {/* Controls paginazione */}
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-2xl border border-black/10 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-black/70">
                          <span className="font-bold text-black/80">
                            Paginazione
                          </span>
                          <span>
                            Mostro <b className="text-black">{pageStart + 1}</b>
                            –<b className="text-black">{pageEnd}</b> su{" "}
                            <b className="text-black">
                              {selectedGroup.sestine.length}
                            </b>
                          </span>
                          <span className="text-black/50">·</span>
                          <span>
                            Pagina <b className="text-black">{pageIndex + 1}</b>{" "}
                            / <b className="text-black">{pageCount}</b>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={pageSize}
                            onChange={(e) =>
                              setPageSize(Number(e.target.value))
                            }
                            className="px-3 py-2 rounded-xl border border-black/10 bg-white text-sm font-bold"
                          >
                            {[50, 100, 200, 500, 1000].map((n) => (
                              <option key={n} value={n}>
                                {n} / pagina
                              </option>
                            ))}
                          </select>

                          <Button
                            onClick={() => setPageIndex(0)}
                            disabled={pageIndex === 0}
                            loading={isGenerating}
                          >
                            ⏮
                          </Button>
                          <Button
                            onClick={() =>
                              setPageIndex((p) => Math.max(0, p - 1))
                            }
                            disabled={pageIndex === 0}
                            loading={isGenerating}
                          >
                            ◀
                          </Button>
                          <Button
                            onClick={() =>
                              setPageIndex((p) =>
                                Math.min(pageCount - 1, p + 1),
                              )
                            }
                            disabled={pageIndex >= pageCount - 1}
                            loading={isGenerating}
                          >
                            ▶
                          </Button>
                          <Button
                            onClick={() => setPageIndex(pageCount - 1)}
                            disabled={pageIndex >= pageCount - 1}
                            loading={isGenerating}
                          >
                            ⏭
                          </Button>
                        </div>
                      </div>

                      {/* Virtualized list */}
                      <div className="mt-3 rounded-2xl border border-black/10 bg-white overflow-hidden">
                        <SestineVirtualList
                          items={pageSestine}
                          evenOdd={evenOdd}
                          lowHigh={lowHigh}
                          onToggleFreeze={(key) =>
                            toggleFreeze(selectedGroup.id, key)
                          }
                          onRemove={(key) =>
                            removeSestina(selectedGroup.id, key)
                          }
                          isBusy={isGenerating}
                        />
                      </div>

                      <div className="mt-2 text-xs text-black/60">
                        Nota: la lista è virtualizzata (renderizza solo gli
                        elementi visibili), quindi resta fluida anche con
                        tantissime sestine.
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-5 border-t border-black/10 pt-4">
                  <h3 className="text-sm font-extrabold text-black/80">
                    Timeline
                  </h3>
                  <div className="mt-2 flex flex-col gap-2">
                    {selectedGroup.events.length === 0 ? (
                      <div className="text-sm text-black/60">
                        Nessun evento.
                      </div>
                    ) : (
                      selectedGroup.events.slice(0, 20).map((ev, idx) => (
                        <div
                          key={idx}
                          className="rounded-2xl border border-black/10 bg-white p-3"
                        >
                          <div className="text-xs text-black/60">
                            {new Date(ev.at).toLocaleString()}
                          </div>
                          {ev.type === "generate" ? (
                            <div className="text-sm font-bold text-black/80">
                              Generazione: +{ev.count}{" "}
                              {ev.seed ? `(seed="${ev.seed}")` : ""}
                            </div>
                          ) : (
                            <div className="text-sm font-bold text-black/80">
                              Validazione: estratti {ev.draw.join(", ")}
                              {ev.jolly ? ` · jolly ${ev.jolly}` : ""}
                              {ev.superstar
                                ? ` · superstar ${ev.superstar}`
                                : ""}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : tab === "stats" ? (
              <>
                <h2 className="text-lg font-extrabold">
                  Statistiche (gruppo selezionato)
                </h2>

                {selectedGroup.sestine.length === 0 ? (
                  <p className="mt-2 text-sm text-black/60">
                    Nessuna sestina: niente statistiche.
                  </p>
                ) : (
                  <>
                    <div className="mt-4">
                      <h3 className="text-sm font-extrabold text-black/80">
                        Top 10 numeri
                      </h3>
                      <div className="mt-3 flex flex-col gap-3">
                        {top10.map((x) => (
                          <div
                            key={x.n}
                            className="grid grid-cols-[50px_1fr_50px] gap-3 items-center"
                          >
                            <div className="text-right font-black">{x.n}</div>
                            <Bar value={x.count} max={maxFreq} />
                            <div className="text-black/70 font-bold">
                              {x.count}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6">
                      <h3 className="text-sm font-extrabold text-black/80">
                        Numeri mai usciti ({missing.length})
                      </h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {missing.map((n) => (
                          <span
                            key={n}
                            className="inline-flex items-center justify-center min-w-[34px] h-8 px-3 rounded-full border border-black/10 bg-white text-sm font-black text-black/80"
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : tab === "validate" ? (
              <>
                <h2 className="text-lg font-extrabold">
                  Validatore estrazione
                </h2>
                <p className="mt-1 text-sm text-black/60">
                  Inserisci i <b>6 numeri estratti</b>. Jolly e SuperStar
                  opzionali. Risultato in report (modal).
                </p>

                <div className="mt-4 grid grid-cols-1 gap-2">
                  <Input
                    value={drawInput}
                    onChange={(e) => setDrawInput(e.target.value)}
                    placeholder="Estratti (6 numeri) es: 10 20 30 40 50 60"
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Input
                      value={jollyInput}
                      onChange={(e) => setJollyInput(e.target.value)}
                      placeholder="Jolly (opzionale)"
                    />
                    <Input
                      value={superstarInput}
                      onChange={(e) => setSuperstarInput(e.target.value)}
                      placeholder="SuperStar (opzionale)"
                    />
                  </div>

                  {validationError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
                      {validationError}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <PrimaryButton
                      onClick={validateAgainstGroup}
                      disabled={
                        !selectedGroup || selectedGroup.sestine.length === 0
                      }
                    >
                      Valida contro gruppo
                    </PrimaryButton>
                    <Button
                      onClick={() => {
                        setValidationError(null);
                        setValidationResult(null);
                      }}
                      disabled={false}
                    >
                      Reset report
                    </Button>
                  </div>

                  <div className="text-xs text-black/60">
                    Regola: servono esattamente 6 numeri unici (1–90). Se sbagli
                    formato, ti blocca.
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-extrabold">Impostazioni</h2>

                <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
                  <h3 className="text-sm font-extrabold text-black/80">
                    Seed riproducibile
                  </h3>
                  <div className="mt-3 flex flex-col gap-2">
                    <Toggle
                      checked={state.settings.seedEnabled}
                      onChange={(v) =>
                        setState((p) => ({
                          ...p,
                          settings: { ...p.settings, seedEnabled: v },
                        }))
                      }
                      label="Usa seed"
                    />
                    <Input
                      value={state.settings.seedValue}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          settings: {
                            ...p.settings,
                            seedValue: e.target.value,
                          },
                        }))
                      }
                      placeholder="Seed (stringa)"
                      disabled={!state.settings.seedEnabled}
                    />
                    <div className="text-xs text-black/60">
                      Stesso seed + stessi vincoli → sequenze riproducibili (ma
                      unicità globale resta).
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-black/10 bg-white p-4">
                  <h3 className="text-sm font-extrabold text-black/80">
                    Vincoli
                  </h3>
                  <div className="mt-3 flex flex-col gap-2">
                    <Input
                      value={state.settings.exclude.join(",")}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          settings: {
                            ...p.settings,
                            exclude: clampNumList(e.target.value),
                          },
                        }))
                      }
                      placeholder="Escludi (es: 13,17)"
                    />
                    <Input
                      value={state.settings.mustInclude.join(",")}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          settings: {
                            ...p.settings,
                            mustInclude: clampNumList(e.target.value).slice(
                              0,
                              6,
                            ),
                          },
                        }))
                      }
                      placeholder="Obbligatori (tutti presenti)"
                    />
                    <Input
                      value={state.settings.mustIncludeAnyOf.join(",")}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          settings: {
                            ...p.settings,
                            mustIncludeAnyOf: clampNumList(e.target.value),
                          },
                        }))
                      }
                      placeholder="Almeno uno tra (es: 7,21,90)"
                    />
                    <div className="text-xs text-black/60">
                      Nota: se metti troppi “obbligatori” (&gt; 6) la
                      generazione fallirà.
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-black/10 bg-white p-4">
                  <h3 className="text-sm font-extrabold text-black/80">
                    Modalità superstizione (gimmick)
                  </h3>
                  <div className="mt-3 flex flex-col gap-2">
                    <Toggle
                      checked={state.settings.superstitionEnabled}
                      onChange={(v) =>
                        setState((p) => ({
                          ...p,
                          settings: { ...p.settings, superstitionEnabled: v },
                        }))
                      }
                      label="Abilita"
                    />
                    <Input
                      value={state.settings.luckyNumbers.join(",")}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          settings: {
                            ...p.settings,
                            luckyNumbers: clampNumList(e.target.value),
                          },
                        }))
                      }
                      placeholder="Numeri fortunati"
                      disabled={!state.settings.superstitionEnabled}
                    />
                    <Input
                      value={state.settings.unluckyNumbers.join(",")}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          settings: {
                            ...p.settings,
                            unluckyNumbers: clampNumList(e.target.value),
                          },
                        }))
                      }
                      placeholder="Numeri sfortunati (esclusi)"
                      disabled={!state.settings.superstitionEnabled}
                    />
                    <input
                      type="date"
                      value={state.settings.birthDate ?? ""}
                      disabled={!state.settings.superstitionEnabled}
                      onChange={(e) =>
                        setState((p) => ({
                          ...p,
                          settings: {
                            ...p.settings,
                            birthDate: e.target.value || undefined,
                          },
                        }))
                      }
                      className={cn(
                        "w-full px-3 py-2 rounded-xl border border-black/10 bg-white outline-none",
                        "focus:ring-2 focus:ring-blue-200 focus:border-blue-200",
                        !state.settings.superstitionEnabled &&
                          "bg-black/5 text-black/40 cursor-not-allowed",
                      )}
                    />
                    <div className="text-xs text-black/60">
                      Se attivo, i “sfortunati” finiscono in exclude e i
                      “fortunati” spingono anyOf.
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-black/10 bg-white p-4">
                  <h3 className="text-sm font-extrabold text-black/80">
                    Evidenziazioni UI
                  </h3>
                  <div className="mt-3 flex flex-col md:flex-row gap-4">
                    <Toggle
                      checked={state.settings.highlightEvenOdd}
                      onChange={(v) =>
                        setState((p) => ({
                          ...p,
                          settings: { ...p.settings, highlightEvenOdd: v },
                        }))
                      }
                      label="Pari/Dispari"
                    />
                    <Toggle
                      checked={state.settings.highlightLowHigh}
                      onChange={(v) =>
                        setState((p) => ({
                          ...p,
                          settings: { ...p.settings, highlightLowHigh: v },
                        }))
                      }
                      label="Bassi/Alti (≤45 / ≥46)"
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-black/10 bg-white p-4">
                  <h3 className="text-sm font-extrabold text-black/80">
                    Banner probabilità
                  </h3>
                  <div className="mt-3">
                    <Toggle
                      checked={state.settings.showOddsBanner}
                      onChange={(v) =>
                        setState((p) => ({
                          ...p,
                          settings: { ...p.settings, showOddsBanner: v },
                        }))
                      }
                      label="Mostra avviso"
                    />
                  </div>
                </div>

                <div className="mt-3 text-xs text-black/60">
                  PWA: resta come l’hai già impostata con vite-plugin-pwa (non
                  dipende da Tailwind).
                </div>
              </>
            )}
          </section>
        </main>

        {/* VALIDATION MODAL */}
        {validationResult && (
          <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onMouseDown={() => setValidationResult(null)}
          >
            <div
              className="w-full max-w-5xl max-h-[88vh] overflow-auto rounded-2xl border border-black/10 bg-white shadow-xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white border-b border-black/10 p-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-black/60">
                    {new Date(validationResult.at).toLocaleString()}
                  </div>
                  <div className="text-xl font-black mt-1">
                    Report validazione — {validationResult.groupName}
                  </div>
                </div>
                <Button
                  variant="danger"
                  onClick={() => setValidationResult(null)}
                >
                  Chiudi
                </Button>
              </div>

              <div className="p-4">
                <div className="rounded-2xl border border-black/10 bg-white p-4">
                  <div className="text-sm font-extrabold text-black/80">
                    Numeri estratti
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {validationResult.draw.map((n) => (
                      <span
                        key={n}
                        className="inline-flex items-center justify-center min-w-[34px] h-8 px-3 rounded-full border border-green-500/30 bg-green-500/10 text-sm font-black"
                      >
                        {n}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-black/70">
                    <span>
                      Jolly:{" "}
                      <b className="text-black">
                        {validationResult.jolly ?? "—"}
                      </b>
                    </span>
                    <span>
                      SuperStar:{" "}
                      <b className="text-black">
                        {validationResult.superstar ?? "—"}
                      </b>
                    </span>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
                  <div className="text-sm font-extrabold text-black/80">
                    Riepilogo
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    {[6, 5, 4, 3, 2, 1, 0].map((k) => (
                      <div
                        key={k}
                        className="rounded-2xl border border-black/10 bg-neutral-50 p-3"
                      >
                        <div className="text-xs font-black text-black/70">
                          {k} / 6
                        </div>
                        <div className="text-2xl font-black">
                          {validationResult.counts[k] ?? 0}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
                  <div className="text-sm font-extrabold text-black/80">
                    Dettaglio sestine (ordinate per match)
                  </div>
                  <div className="mt-3 flex flex-col gap-3">
                    {validationResult.rows.slice(0, 200).map((r) => (
                      <div
                        key={r.key}
                        className={cn(
                          "rounded-2xl border p-3",
                          r.frozen
                            ? "bg-blue-50 border-blue-200"
                            : "bg-white border-black/10",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-black px-2 py-1 rounded-full border border-black/10 bg-black/5">
                            {r.hits} match
                          </span>
                          {r.jollyHit && (
                            <span className="text-xs font-black px-2 py-1 rounded-full border border-green-500/25 bg-green-500/10">
                              Jolly
                            </span>
                          )}
                          {r.superstarHit && (
                            <span className="text-xs font-black px-2 py-1 rounded-full border border-green-500/25 bg-green-500/10">
                              SuperStar
                            </span>
                          )}
                          {r.frozen && (
                            <span className="text-xs font-black px-2 py-1 rounded-full border border-blue-500/25 bg-blue-500/10">
                              Bloccata
                            </span>
                          )}
                          <span className="text-xs text-black/55 font-mono break-all">
                            {r.key}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          {r.nums.map((n) => (
                            <Chip
                              key={n}
                              n={n}
                              isHit={r.hitNums.includes(n)}
                              evenOdd={evenOdd}
                              lowHigh={lowHigh}
                            />
                          ))}
                        </div>
                      </div>
                    ))}

                    {validationResult.rows.length > 200 && (
                      <div className="text-xs text-black/60">
                        Mostrate solo le prime 200 (per non appesantire la UI).
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {genModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl border border-black/10 bg-white shadow-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-black/60">
                    Operazione in corso
                  </div>
                  <div className="text-lg font-black mt-1">
                    Generazione sestine — {genModal.groupName}
                  </div>
                </div>
                <Button
                  variant="danger"
                  onClick={() => {
                    genAbortRef.current = true;
                  }}
                >
                  Annulla
                </Button>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-sm font-bold text-black/70">
                  <span>
                    {genModal.done} / {genModal.total}
                  </span>
                  <span>
                    {genModal.total
                      ? Math.floor((genModal.done / genModal.total) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-black/10 overflow-hidden">
                  <div
                    className="h-full bg-blue-500/60"
                    style={{
                      width: `${genModal.total ? (genModal.done / genModal.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="mt-3 text-xs text-black/60">
                  Sto generando in blocchi per non bloccare il browser. Attendi…
                </div>
              </div>
            </div>
          </div>
        )}

        <footer className="mt-10 border-t border-black/10 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-sm text-black/70">
              {/* Left */}
              <div className="text-center md:text-left">
                <div className="font-extrabold text-black">
                  SuperEnalotto Sestine
                </div>
                <div className="text-xs text-black/50">
                  Generatore e validatore di sestine · frontend-only
                </div>
              </div>

              {/* Center */}
              <div className="flex justify-center gap-4 text-sm">
                <a
                  href="https://github.com/AleMoz97"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold hover:text-black transition"
                >
                  GitHub
                </a>
                <a
                  href="https://www.linkedin.com/in/alessandro-mozzato-32479420b/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold hover:text-black transition"
                >
                  LinkedIn
                </a>
                <a
                  href="mailto:alessandromozzato8@gmail.com"
                  className="font-bold hover:text-black transition"
                >
                  Contatto
                </a>
              </div>

              {/* Right */}
              <div className="text-center md:text-right text-xs text-black/50">
                © {new Date().getFullYear()} ·
                <span className="ml-1">
                  Creato da <b className="text-black">Alessandro Mozzato</b>
                </span>
              </div>
            </div>

            <div className="mt-4 text-center text-[11px] text-black/40">
              Questo strumento non aumenta le probabilità di vincita. È fornito
              a scopo informativo e di intrattenimento.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
