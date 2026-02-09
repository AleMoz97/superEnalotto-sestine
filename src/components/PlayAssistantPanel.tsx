import React, { useEffect, useMemo, useState } from "react";

type Sestina = {
  key: string;
  nums: number[];
  frozen?: boolean;
};

type Group = {
  id: string;
  name: string;
  sestine: Sestina[];
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
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
    "px-3 py-2 rounded-2xl border font-extrabold transition select-none inline-flex items-center gap-2 justify-center active:scale-[0.99]";
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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function PlayAssistPanel({
  groups,
  defaultGroupId,
}: {
  groups: Group[];
  defaultGroupId?: string | null;
}) {
  const [groupId, setGroupId] = useState<string | null>(defaultGroupId ?? null);
  const [onlyFrozen, setOnlyFrozen] = useState(false);
  const [autoCopyOnNext, setAutoCopyOnNext] = useState(true);
  const [idx, setIdx] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // inizializzazione quando cambia il default (es. cambi gruppo in sidebar)
  useEffect(() => {
    setGroupId(defaultGroupId ?? (groups[0]?.id ?? null));
    setIdx(0);
  }, [defaultGroupId, groups]);

  const selectedGroup = useMemo(() => {
    if (!groupId) return null;
    return groups.find((g) => g.id === groupId) ?? null;
  }, [groups, groupId]);

  const playable = useMemo(() => {
    const list = selectedGroup?.sestine ?? [];
    const filtered = onlyFrozen ? list.filter((s) => !!s.frozen) : list;
    return filtered.filter((s) => Array.isArray(s.nums) && s.nums.length === 6);
  }, [selectedGroup, onlyFrozen]);

  useEffect(() => {
    if (idx > playable.length - 1) setIdx(0);
  }, [idx, playable.length]);

  const current = playable[idx] ?? null;

  function formatOne(s: Sestina) {
    return s.nums.join(" ");
  }

  function formatAll(list: Sestina[]) {
    return list.map((s) => s.nums.join(" ")).join("\n");
  }

  async function doCopyCurrent() {
    if (!current) return;
    const ok = await copyToClipboard(formatOne(current));
    setToast(ok ? "Sestina copiata ✅" : "Impossibile copiare ❌");
    window.setTimeout(() => setToast(null), 1200);
  }

  async function doCopyAll() {
    if (playable.length === 0) return;
    const ok = await copyToClipboard(formatAll(playable));
    setToast(ok ? `Copiate ${playable.length} sestine ✅` : "Impossibile copiare ❌");
    window.setTimeout(() => setToast(null), 1400);
  }

  async function next(copyToo = false) {
    if (playable.length === 0) return;
    const nextIdx = (idx + 1) % playable.length;
    setIdx(nextIdx);

    if (copyToo || autoCopyOnNext) {
      const nextItem = playable[nextIdx];
      if (nextItem) {
        const ok = await copyToClipboard(formatOne(nextItem));
        setToast(ok ? "Copiata (next) ✅" : "Impossibile copiare ❌");
        window.setTimeout(() => setToast(null), 900);
      }
    }
  }

  function prev() {
    if (playable.length === 0) return;
    const prevIdx = (idx - 1 + playable.length) % playable.length;
    setIdx(prevIdx);
  }

  return (
    <div className="animate-fadeUp">
      <div className="rounded-3xl border border-black/10 bg-white p-4">
        <div className="text-xs text-black/60">Giocata assistita</div>
        <div className="text-2xl font-black">Compilazione assistita</div>
        <div className="text-sm text-black/60 mt-1">
          Non piazza la giocata: ti copia le sestine negli appunti e ti guida una per volta.
        </div>
      </div>

      {/* CONTROLS */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-start">
        <div className="rounded-3xl border border-black/10 bg-white p-4">
          <div className="text-sm font-black text-black/80">Selezione</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
            <select
              value={groupId ?? ""}
              onChange={(e) => {
                setGroupId(e.target.value || null);
                setIdx(0);
              }}
              className="w-full px-3 py-3 rounded-2xl border border-black/10 bg-white font-bold"
            >
              {groups.length === 0 ? (
                <option value="">Nessun gruppo</option>
              ) : (
                groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.sestine.length})
                  </option>
                ))
              )}
            </select>

            <div className="flex items-center gap-2 justify-start md:justify-end">
              <label className="inline-flex items-center gap-2 text-sm font-extrabold text-black/70">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={onlyFrozen}
                  onChange={(e) => {
                    setOnlyFrozen(e.target.checked);
                    setIdx(0);
                  }}
                />
                Solo frozen
              </label>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm font-bold text-black/70">
              <input
                type="checkbox"
                className="accent-blue-600"
                checked={autoCopyOnNext}
                onChange={(e) => setAutoCopyOnNext(e.target.checked)}
              />
              Copia automaticamente quando passo alla prossima
            </label>
          </div>

          <div className="mt-3 text-xs text-black/60">
            Filtrato: <b>{playable.length}</b> sestine {onlyFrozen ? "(solo frozen)" : "(tutte)"}.
          </div>
        </div>

        <div className="rounded-3xl border border-black/10 bg-white p-4">
          <div className="text-sm font-black text-black/80">Azioni</div>
          <div className="mt-3 flex flex-col gap-2">
            <Button onClick={doCopyAll} disabled={playable.length === 0} className="w-full">
              Copia tutte ({playable.length})
            </Button>

            <button
              onClick={() => window.open("https://www.superenalotto.it/dove-si-gioca/online.html", "_blank")}
              className="w-full px-4 py-3 rounded-2xl border border-black/10 bg-black/5 font-extrabold hover:bg-black/10"
              title="Apri pagina con i siti online"
            >
              Apri siti di gioco ↗
            </button>

            <div className="text-xs text-black/60">
              (Apriamo solo la pagina informativa: tu giochi sul sito.)
            </div>
          </div>
        </div>
      </div>

      {/* CURRENT */}
      <div className="mt-4 rounded-3xl border border-black/10 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-black/80">Sestina corrente</div>
            <div className="text-xs text-black/60 mt-1">
              {selectedGroup ? (
                <>
                  Gruppo: <b>{selectedGroup.name}</b> ·{" "}
                  {playable.length === 0 ? "—" : `${idx + 1} / ${playable.length}`}
                </>
              ) : (
                "Nessun gruppo selezionato"
              )}
            </div>
          </div>

          {toast ? (
            <div className="text-xs font-black px-3 py-1 rounded-full border border-black/10 bg-white/70">
              {toast}
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          {current ? (
            <div className="rounded-3xl border border-black/10 bg-neutral-50 p-6 flex items-center justify-center">
              <div className="text-3xl md:text-5xl font-black tracking-wide">
                {current.nums.join(" ")}
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-black/10 bg-neutral-50 p-6 text-sm text-black/60">
              Nessuna sestina disponibile con il filtro attuale.
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <Button onClick={prev} disabled={playable.length === 0} className="w-full">
            ← Prev
          </Button>

          <Button onClick={doCopyCurrent} disabled={!current} className="w-full">
            Copia
          </Button>

          <Button onClick={() => next(true)} disabled={playable.length === 0} className="w-full">
            Next + copia →
          </Button>
        </div>

        <div className="mt-3 text-xs text-black/60">
          Tip: apri il sito in un’altra scheda, poi usa “Next + copia” per scorrere velocemente.
        </div>
      </div>
    </div>
  );
}
