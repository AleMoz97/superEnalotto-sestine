import React, { useMemo, useRef, useState } from "react";
import { newId, type AppState, type Group } from "../lib/storage";
import { createPortal } from "react-dom";

type Sestina = {
  key: string;
  nums: number[];
  createdAt: string;
  frozen: boolean;
  meta?: any;
};

type ImportMode = "merge" | "replace";

type ImportReport = {
  importedGroups: number;
  importedSestine: number;
  skippedInvalid: number;
  skippedDuplicates: number;
  allowedDuplicates: number;
  movedDuplicates: number;
  markedDuplicates: number;
  renamedGroups: number;
  duplicateCases: number;
  incomingInternalDuplicates: number;
};

type ExistingRef = {
  groupId: string;
  groupName: string;
  key: string;
};

type IncomingRef = {
  groupName: string;
  sourceGroupName?: string;
  tempId: string;
};

type DuplicateAction = "skip" | "allow" | "move" | "mark";

type DuplicateCase = {
  sig: string;
  nums: number[];
  existing: ExistingRef[];
  incoming: IncomingRef[];
  action: DuplicateAction;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function normalizeNums(nums: number[]): number[] {
  const cleaned = nums
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.floor(n))
    .filter((n) => n >= 1 && n <= 90);
  const uniq = Array.from(new Set(cleaned));
  uniq.sort((a, b) => a - b);
  return uniq;
}

function sigFromNums(nums: number[]) {
  return nums.join("-");
}

function tryParseCSV(text: string): {
  groups: { groupName: string; nums: number[] }[];
  invalid: number;
} {
  // CSV support minimo:
  // - Riga: groupName, n1, n2, n3, n4, n5, n6
  // - oppure senza groupName: n1..n6 (in quel caso groupName="Import")
  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let invalid = 0;
  const out: { groupName: string; nums: number[] }[] = [];

  for (const line of lines) {
    const parts = line
      .split(/[;,]/g)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length < 6) {
      invalid++;
      continue;
    }

    // prova groupName se la prima colonna non è numero
    const firstNum = Number(parts[0]);
    let groupName = "Import";
    let numsPart = parts;

    if (!Number.isFinite(firstNum)) {
      groupName = parts[0] || "Import";
      numsPart = parts.slice(1);
    }

    const nums = numsPart
      .slice(0, 6)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));

    const norm = normalizeNums(nums);
    if (norm.length !== 6) {
      invalid++;
      continue;
    }

    out.push({ groupName, nums: norm });
  }

  return { groups: out, invalid };
}

function extractGroupsFromJson(obj: any): {
  groups: any[];
  modeHint?: ImportMode;
} {
  // accetta:
  // - AppState completo: { groups: [...], settings: ... }
  // - { groups: [...] }
  // - array di gruppi: [...]
  if (!obj) return { groups: [] };

  if (Array.isArray(obj)) return { groups: obj };

  if (Array.isArray(obj.groups)) return { groups: obj.groups };

  // fallback: se esiste "state"
  if (obj.state && Array.isArray(obj.state.groups))
    return { groups: obj.state.groups };

  return { groups: [] };
}

function ensureUniqueGroupName(
  name: string,
  existingNames: Set<string>,
): { finalName: string; renamed: boolean } {
  const base = name.trim() || "Import";
  if (!existingNames.has(base)) return { finalName: base, renamed: false };

  let i = 2;
  while (existingNames.has(`${base} (import ${i})`)) i++;
  return { finalName: `${base} (import ${i})`, renamed: true };
}

function SimpleModal({
  title,
  children,
  onClose,
  closeLabel = "Chiudi",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeLabel?: string;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[88vh] overflow-auto rounded-2xl border border-black/10 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-black/10 p-4 flex items-start justify-between gap-3">
          <div className="text-xl font-black">{title}</div>
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-800 font-extrabold hover:bg-red-100"
          >
            {closeLabel}
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default function ImportPanel({
  state,
  setState,
  disabled,
  onAfterImport,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  disabled?: boolean;
  onAfterImport?: (newGroupId?: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<ImportMode>("merge");
  const [loading, setLoading] = useState(false);

  const [pendingGroups, setPendingGroups] = useState<Group[] | null>(null);
  const [pendingSestineByGroup, setPendingSestineByGroup] = useState<Map<
    string,
    { nums: number[]; sig: string }[]
  > | null>(null);

  const [report, setReport] = useState<ImportReport | null>(null);

  const [dupCases, setDupCases] = useState<DuplicateCase[] | null>(null);
  const [showDupModal, setShowDupModal] = useState(false);

  const existingSigIndex = useMemo(() => {
    // sig -> list of refs (potrebbero già esserci duplicati nel tuo dataset, li supportiamo)
    const map = new Map<string, ExistingRef[]>();
    for (const g of state.groups) {
      for (const s of g.sestine as any[]) {
        const nums = normalizeNums((s?.nums ?? []) as number[]);
        if (nums.length !== 6) continue;
        const sig = sigFromNums(nums);
        const arr = map.get(sig) ?? [];
        arr.push({ groupId: g.id, groupName: g.name, key: String(s.key) });
        map.set(sig, arr);
      }
    }
    return map;
  }, [state.groups]);

  function resetInternal() {
    setPendingGroups(null);
    setPendingSestineByGroup(null);
    setDupCases(null);
    setShowDupModal(false);
    setReport(null);
  }

  async function handleFile(file: File) {
    resetInternal();
    setLoading(true);

    try {
      const text = await file.text();
      const ext = (file.name.split(".").pop() || "").toLowerCase();

      let extracted: { groupName: string; nums: number[] }[] = [];
      let invalid = 0;

      if (ext === "csv") {
        const parsed = tryParseCSV(text);
        invalid = parsed.invalid;
        extracted = parsed.groups;
      } else {
        // JSON
        let obj: any;
        try {
          obj = JSON.parse(text);
        } catch {
          throw new Error("JSON non valido.");
        }

        const { groups } = extractGroupsFromJson(obj);
        if (!groups.length)
          throw new Error(
            "Nel JSON non trovo gruppi validi (manca 'groups' o è vuoto).",
          );

        // Supporta:
        // - gruppi in formato app (con g.sestine)
        // - oppure {name, nums[]} custom
        const tmp: {
          groupName: string;
          nums: number[];
          sourceGroupName?: string;
        }[] = [];
        for (const g of groups) {
          const gName = String(g?.name ?? "Import");
          const list = Array.isArray(g?.sestine)
            ? g.sestine
            : Array.isArray(g?.items)
              ? g.items
              : [];
          if (Array.isArray(list) && list.length > 0) {
            for (const it of list) {
              const nums = normalizeNums(
                (it?.nums ?? it?.numbers ?? []) as number[],
              );
              if (nums.length !== 6) {
                invalid++;
                continue;
              }
              tmp.push({ groupName: gName, nums, sourceGroupName: gName });
            }
          } else if (Array.isArray(g?.nums)) {
            // singolo gruppo con nums? (raro)
            const nums = normalizeNums(g.nums);
            if (nums.length !== 6) invalid++;
            else tmp.push({ groupName: gName, nums, sourceGroupName: gName });
          }
        }

        extracted = tmp.map((x) => ({ groupName: x.groupName, nums: x.nums }));
      }

      if (extracted.length === 0) {
        throw new Error("Nessuna sestina importabile trovata nel file.");
      }

      // raggruppa per groupName
      const byName = new Map<string, { nums: number[]; sig: string }[]>();
      for (const row of extracted) {
        const norm = normalizeNums(row.nums);
        if (norm.length !== 6) {
          invalid++;
          continue;
        }
        const sig = sigFromNums(norm);
        const arr = byName.get(row.groupName) ?? [];
        arr.push({ nums: norm, sig });
        byName.set(row.groupName, arr);
      }

      // dedupe interno al file: se lo stesso sig appare più volte, tienine 1 (reportiamo quanti scartati)
      let incomingInternalDuplicates = 0;
      for (const [name, arr] of byName) {
        const seen = new Set<string>();
        const out: typeof arr = [];
        for (const x of arr) {
          if (seen.has(x.sig)) {
            incomingInternalDuplicates++;
            continue;
          }
          seen.add(x.sig);
          out.push(x);
        }
        byName.set(name, out);
      }

      // prepara pendingGroups con nomi unici
      const existingNames = new Set(state.groups.map((g) => g.name));
      let renamedGroups = 0;

      const groupsToCreate: Group[] = [];
      const pending = new Map<string, { nums: number[]; sig: string }[]>();

      for (const [incomingName, items] of byName) {
        const { finalName, renamed } = ensureUniqueGroupName(
          incomingName,
          existingNames,
        );
        if (renamed) renamedGroups++;
        existingNames.add(finalName);

        const gid = newId("group");
        groupsToCreate.push({
          id: gid,
          name: finalName,
          createdAt: new Date().toISOString(),
          sestine: [],
          events: [],
        } as any);

        pending.set(gid, items);
      }

      setPendingGroups(groupsToCreate);
      setPendingSestineByGroup(pending);

      // costruisci duplicate cases
      const dupMap = new Map<string, DuplicateCase>();
      let totalIncoming = 0;

      for (const g of groupsToCreate) {
        const items = pending.get(g.id) ?? [];
        for (const it of items) {
          totalIncoming++;
          const existing = existingSigIndex.get(it.sig);
          if (!existing || existing.length === 0) continue;

          const prev = dupMap.get(it.sig);
          if (!prev) {
            dupMap.set(it.sig, {
              sig: it.sig,
              nums: it.nums,
              existing,
              incoming: [{ groupName: g.name, tempId: `${g.id}:${it.sig}` }],
              action: "skip", // default sicuro
            });
          } else {
            prev.incoming.push({
              groupName: g.name,
              tempId: `${g.id}:${it.sig}`,
            });
          }
        }
      }

      const dupCasesArr = Array.from(dupMap.values());
      setDupCases(dupCasesArr);
      setReport({
        importedGroups: groupsToCreate.length,
        importedSestine: 0,
        skippedInvalid: invalid,
        skippedDuplicates: 0,
        allowedDuplicates: 0,
        movedDuplicates: 0,
        markedDuplicates: 0,
        renamedGroups,
        duplicateCases: dupCasesArr.length,
        incomingInternalDuplicates,
      });

      if (dupCasesArr.length > 0) {
        setShowDupModal(true);
      } else {
        // merge immediato
        applyImport(groupsToCreate, pending, [], mode, {
          skippedInvalid: invalid,
          renamedGroups,
          incomingInternalDuplicates,
        });
      }
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function applyImport(
    groupsToCreate: Group[],
    pending: Map<string, { nums: number[]; sig: string }[]>,
    dupCasesResolved: DuplicateCase[],
    importMode: ImportMode,
    carry: {
      skippedInvalid: number;
      renamedGroups: number;
      incomingInternalDuplicates: number;
    },
  ) {
    // prepara decisioni per sig
    const actionBySig = new Map<string, DuplicateAction>();
    for (const c of dupCasesResolved) actionBySig.set(c.sig, c.action);

    const finalReport: ImportReport = {
      importedGroups: groupsToCreate.length,
      importedSestine: 0, // lo riempiamo sotto
      skippedInvalid: carry.skippedInvalid,
      skippedDuplicates: 0,
      allowedDuplicates: 0,
      movedDuplicates: 0,
      markedDuplicates: 0,
      renamedGroups: carry.renamedGroups,
      duplicateCases: dupCasesResolved.length,
      incomingInternalDuplicates: carry.incomingInternalDuplicates,
    };

    // build new groups with sestine
    let importedSestine = 0;
    let skippedDuplicates = 0;
    let allowedDuplicates = 0;
    let movedDuplicates = 0;
    let markedDuplicates = 0;

    // per "move": dobbiamo rimuovere dai gruppi esistenti qualsiasi sestina con quella signature
    const sigToMove = new Set<string>();
    for (const c of dupCasesResolved)
      if (c.action === "move") sigToMove.add(c.sig);

    setState((prev) => {
      let baseGroups = prev.groups;

      if (importMode === "replace") {
        baseGroups = []; // wipe
      } else {
        // merge: se move attivo, puliamo i vecchi gruppi
        if (sigToMove.size > 0) {
          baseGroups = baseGroups.map((g) => {
            const kept = (g.sestine as any[]).filter((s) => {
              const nums = normalizeNums((s?.nums ?? []) as number[]);
              if (nums.length !== 6) return true;
              const sig = sigFromNums(nums);
              return !sigToMove.has(sig);
            });
            return { ...g, sestine: kept } as any;
          });
        }
      }

      const existingKeys = new Set<string>();
      for (const g of baseGroups)
        for (const s of g.sestine as any[]) existingKeys.add(String(s.key));

      // build created groups
      const createdGroups: Group[] = groupsToCreate.map((g) => {
        const items = pending.get(g.id) ?? [];
        const sestine: Sestina[] = [];

        for (const it of items) {
          const act = actionBySig.get(it.sig);
          if (!act) {
            // non duplicato
            const key = uniqueKey(existingKeys);
            sestine.push({
              key,
              nums: it.nums,
              frozen: false,
              createdAt: new Date().toISOString(),
            });
            importedSestine++;
            continue;
          }

          if (act === "skip") {
            skippedDuplicates++;
            continue;
          }

          if (act === "allow") {
            const key = uniqueKey(existingKeys);
            sestine.push({
              key,
              nums: it.nums,
              frozen: false,
              createdAt: new Date().toISOString(),
              meta: { ...(undefined as any), importDuplicate: true },
            });
            importedSestine++;
            allowedDuplicates++;
            continue;
          }

          if (act === "mark") {
            const key = uniqueKey(existingKeys);
            sestine.push({
              key,
              nums: it.nums,
              frozen: false,
              createdAt: new Date().toISOString(),
              meta: { importDuplicate: true, duplicateOf: it.sig },
            });
            importedSestine++;
            markedDuplicates++;
            continue;
          }

          if (act === "move") {
            const key = uniqueKey(existingKeys);
            sestine.push({
              key,
              nums: it.nums,
              frozen: false,
              createdAt: new Date().toISOString(),
              meta: { movedFromOtherGroup: true, duplicateOf: it.sig },
            });
            importedSestine++;
            movedDuplicates++;
            continue;
          }
        }

        const ev = {
          type: "import" as const,
          at: new Date().toISOString(),
          count: sestine.length,
          mode: importMode,
        };

        return {
          ...(g as any),
          sestine,
          events: [ev, ...(g as any).events],
        } as any;
      });
      // aggiorna report finale coi contatori calcolati
      finalReport.importedGroups = createdGroups.length;
      finalReport.importedSestine = importedSestine;
      finalReport.skippedDuplicates = skippedDuplicates;
      finalReport.allowedDuplicates = allowedDuplicates;
      finalReport.movedDuplicates = movedDuplicates;
      finalReport.markedDuplicates = markedDuplicates;

      const next: AppState = {
        ...prev,
        groups: [...createdGroups, ...baseGroups],
      };

      // opzionale: seleziona il primo gruppo importato
      if (createdGroups[0]?.id) onAfterImport?.(createdGroups[0].id);

      return next;
    });

    // pulisci pending
    setReport(finalReport);
    setPendingGroups(null);
    setPendingSestineByGroup(null);
    setDupCases(null);
    setShowDupModal(false);
    if (groupsToCreate[0]?.id) onAfterImport?.(groupsToCreate[0].id);
  }

  function uniqueKey(existingKeys: Set<string>) {
    let k = newId("sestina");
    while (existingKeys.has(k)) k = newId("sestina");
    existingKeys.add(k);
    return k;
  }

  function setAllActions(action: DuplicateAction) {
    if (!dupCases) return;
    setDupCases(dupCases.map((c) => ({ ...c, action })));
  }

  const previewDupCases = useMemo(() => {
    if (!dupCases) return [];
    // ordina per “quante incoming”
    const sorted = [...dupCases].sort(
      (a, b) => b.incoming.length - a.incoming.length,
    );
    return sorted.slice(0, 200);
  }, [dupCases]);

  const tooManyDup = dupCases ? dupCases.length > 200 : false;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-black">Import</div>
          <div className="text-sm text-black/60 mt-1">
            Importa JSON (export app) o CSV (groupName,n1..n6). Gestiamo
            duplicati con una schermata di risoluzione.
          </div>
        </div>
        
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="text-sm font-extrabold text-black/80">Modalità:</div>
        <label className="inline-flex items-center gap-2 text-sm font-bold text-black/70">
          <input
            type="radio"
            checked={mode === "merge"}
            onChange={() => setMode("merge")}
            className="accent-blue-600"
          />
          Merge (aggiungi)
        </label>
        <label className="inline-flex items-center gap-2 text-sm font-bold text-black/70">
          <input
            type="radio"
            checked={mode === "replace"}
            onChange={() => setMode("replace")}
            className="accent-blue-600"
          />
          Replace (sostituisci tutto)
        </label>
        <button
          disabled={disabled || loading}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "w-full px-6 py-4 rounded-2xl border text-base font-extrabold transition",
            disabled || loading
                ? "border-black/10 bg-black/5 text-black/40 cursor-not-allowed"
                : "border-black/10 bg-black text-white hover:bg-black/90",
            )}
            >
          {loading ? "Carico…" : "Scegli file"}
        </button>
      </div>

      {report && (
        <div className="mt-4 rounded-2xl border border-black/10 bg-neutral-50 p-3 text-sm text-black/80">
          <div className="font-extrabold">Riepilogo import (preview)</div>
          <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-1">
            <div>
              Gruppi da importare: <b>{report.importedGroups}</b>{" "}
              {report.renamedGroups
                ? `(rinominati: ${report.renamedGroups})`
                : ""}
            </div>
            <div>
              Sestine valide trovate:{" "}
              <b>
                {pendingSestineByGroup
                  ? Array.from(pendingSestineByGroup.values()).reduce(
                      (a, x) => a + x.length,
                      0,
                    )
                  : 0}
              </b>
            </div>
            <div>
              Righe invalide scartate: <b>{report.skippedInvalid}</b>
            </div>
            <div>
              Duplicati rilevati: <b>{report.duplicateCases}</b>{" "}
              {report.incomingInternalDuplicates
                ? `(duplicati nel file rimossi: ${report.incomingInternalDuplicates})`
                : ""}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DUPLICATI */}
      {showDupModal && dupCases && pendingGroups && pendingSestineByGroup && (
        <SimpleModal
          title={`Risoluzione duplicati (${dupCases.length})`}
          onClose={() => {
            // chiudere qui = annullare import, per sicurezza
            setShowDupModal(false);
            setPendingGroups(null);
            setPendingSestineByGroup(null);
            setDupCases(null);
          }}
          closeLabel="Annulla import"
        >
          <div className="text-sm text-black/70">
            Duplicato = stessa combinazione (ordine irrilevante). Scegli cosa
            fare.
            <div className="mt-1 text-xs text-black/60">
              Default: <b>Salta</b> (scelta più sicura).
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <div className="text-sm font-extrabold text-black/80">
              Applica a tutti:
            </div>
            <button
              onClick={() => setAllActions("skip")}
              className="px-3 py-2 rounded-xl border border-black/10 bg-white font-extrabold hover:bg-black/[0.03]"
            >
              Salta
            </button>
            <button
              onClick={() => setAllActions("allow")}
              className="px-3 py-2 rounded-xl border border-black/10 bg-white font-extrabold hover:bg-black/[0.03]"
            >
              Importa comunque
            </button>
            <button
              onClick={() => setAllActions("move")}
              className="px-3 py-2 rounded-xl border border-black/10 bg-white font-extrabold hover:bg-black/[0.03]"
            >
              Sposta
            </button>
            <button
              onClick={() => setAllActions("mark")}
              className="px-3 py-2 rounded-xl border border-black/10 bg-white font-extrabold hover:bg-black/[0.03]"
            >
              Duplica ma marca
            </button>
          </div>

          {tooManyDup && (
            <div className="mt-3 rounded-2xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-black/80">
              Ci sono <b>{dupCases.length}</b> duplicati: per performance mostro
              solo i primi <b>200</b>. Usa “Applica a tutti” se non vuoi
              gestirli uno a uno.
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3">
            {previewDupCases.map((c) => (
              <div
                key={c.sig}
                className="rounded-2xl border border-black/10 bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black">
                    {c.nums.join(" ")}
                    <span className="ml-2 text-xs text-black/50 font-mono">
                      sig: {c.sig}
                    </span>
                  </div>

                  <select
                    value={c.action}
                    onChange={(e) => {
                      const v = e.target.value as DuplicateAction;
                      setDupCases((prev) =>
                        prev
                          ? prev.map((x) =>
                              x.sig === c.sig ? { ...x, action: v } : x,
                            )
                          : prev,
                      );
                    }}
                    className="px-3 py-2 rounded-xl border border-black/10 bg-white font-extrabold text-sm"
                  >
                    <option value="skip">Salta</option>
                    <option value="allow">Importa comunque</option>
                    <option value="move">Sposta</option>
                    <option value="mark">Duplica ma marca</option>
                  </select>
                </div>

                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl border border-black/10 bg-neutral-50 p-2">
                    <div className="text-xs font-extrabold text-black/60">
                      Già presente in:
                    </div>
                    <ul className="mt-1 list-disc pl-5">
                      {c.existing.slice(0, 5).map((ex) => (
                        <li key={ex.groupId + ex.key} className="text-black/80">
                          <b>{ex.groupName}</b>{" "}
                          <span className="text-xs text-black/50 font-mono">
                            ({ex.key})
                          </span>
                        </li>
                      ))}
                      {c.existing.length > 5 && (
                        <li className="text-black/60">
                          … +{c.existing.length - 5}
                        </li>
                      )}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-black/10 bg-neutral-50 p-2">
                    <div className="text-xs font-extrabold text-black/60">
                      Nel file import (target):
                    </div>
                    <ul className="mt-1 list-disc pl-5">
                      {c.incoming.slice(0, 5).map((inc) => (
                        <li key={inc.tempId} className="text-black/80">
                          <b>{inc.groupName}</b>
                        </li>
                      ))}
                      {c.incoming.length > 5 && (
                        <li className="text-black/60">
                          … +{c.incoming.length - 5}
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                // conferma import applicando le scelte su dupCases (complete, non solo preview)
                applyImport(
                  pendingGroups,
                  pendingSestineByGroup,
                  dupCases,
                  mode,
                  {
                    skippedInvalid: report?.skippedInvalid ?? 0,
                    renamedGroups: report?.renamedGroups ?? 0,
                    incomingInternalDuplicates:
                      report?.incomingInternalDuplicates ?? 0,
                  },
                );
              }}
              className="px-3 py-2 rounded-xl border border-black/10 bg-black text-white font-extrabold hover:bg-black/90"
            >
              Conferma import
            </button>
          </div>

          <div className="mt-3 text-xs text-black/60">
            Note azioni:
            <ul className="list-disc pl-5 mt-1">
              <li>
                <b>Salta</b>: non importo quella combinazione.
              </li>
              <li>
                <b>Importa comunque</b>: importo anche se duplicata (non
                consigliato).
              </li>
              <li>
                <b>Sposta</b>: rimuovo la combinazione dai gruppi esistenti e la
                metto in quello importato.
              </li>
              <li>
                <b>Duplica ma marca</b>: importo e aggiungo meta{" "}
                <span className="font-mono">duplicateOf</span>.
              </li>
            </ul>
          </div>
        </SimpleModal>
      )}

      {/* REPORT finale */}
      {report && pendingGroups === null && (
        <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-black/80">
          <div className="font-extrabold">Import completato</div>
          <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-1">
            <div>
              Gruppi importati: <b>{report.importedGroups}</b>
            </div>
            <div>
              Sestine importate: <b>{report.importedSestine}</b>
            </div>
            <div>
              Invalide scartate: <b>{report.skippedInvalid}</b>
            </div>
            <div>
              Duplicati saltati: <b>{report.skippedDuplicates}</b>
            </div>
            <div>
              Duplicati importati: <b>{report.allowedDuplicates}</b>
            </div>
            <div>
              Duplicati spostati: <b>{report.movedDuplicates}</b>
            </div>
            <div>
              Duplicati marcati: <b>{report.markedDuplicates}</b>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
