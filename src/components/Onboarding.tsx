import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type StepKey =
  | "intro"
  | "groups"
  | "generate"
  | "play"
  | "validate"
  | "win"
  | "settings";

type Step = {
  key: StepKey;
  title: string;
  body: React.ReactNode;
  anchor?: string; // data-onb="<anchor>"
  placement?: "right" | "left" | "bottom" | "top";
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function findAnchors(anchor?: string) {
  if (!anchor) return [];
  const keys = anchor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return keys
    .map(
      (k) => document.querySelector(`[data-onb="${k}"]`) as HTMLElement | null,
    )
    .filter((el): el is HTMLElement => Boolean(el));
}

function getTooltipPos(
  el: HTMLElement,
  placement: NonNullable<Step["placement"]>,
  width = 360,
  gap = 12,
) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // base positions (viewport coords)
  let left = 0;
  let top = 0;

  if (placement === "right") {
    left = r.right + gap;
    top = r.top + r.height / 2;
  } else if (placement === "left") {
    left = r.left - gap - width;
    top = r.top + r.height / 2;
  } else if (placement === "bottom") {
    left = r.left + r.width / 2;
    top = r.bottom + gap;
  } else {
    // top
    left = r.left + r.width / 2;
    top = r.top - gap;
  }

  // adjust to keep in viewport
  // we treat tooltip as centered on (left, top) for top/bottom, and vertically centered for left/right
  const maxLeft = vw - width - 16;
  const minLeft = 16;

  if (placement === "right" || placement === "left") {
    const t = top - 80; // approximate half height
    top = clamp(t, 16, vh - 200);
    left = clamp(left, minLeft, maxLeft);
  } else {
    left = clamp(left - width / 2, minLeft, maxLeft);
    top = clamp(top, 16, vh - 220);
  }

  return { left, top };
}

export default function Onboarding({
  open,
  onClose,
  onRequestTab,
  storageKey = "sextina_onboarding_done",
  version = "v1",
  groupsCount,
}: {
  open: boolean;
  onClose: () => void;
  onRequestTab?: (tab: string) => void;
  storageKey?: string;
  version?: string;
  groupsCount: number;
}) {
  const fullStorageKey = `${storageKey}:${version}`;
  const steps: Step[] = useMemo(
    () => [
      {
        key: "intro",
        title: "Prima di iniziare",
        body: (
          <div className="text-sm text-black/70 leading-relaxed">
            Questa app <b>non predice</b> i numeri del SuperEnalotto.
            <br />
            Serve per <b>generare</b> sestine casuali, <b>organizzarle</b>, e
            <b> giocarle più comodamente</b> (copia/incolla assistito).
            <div className="mt-3 rounded-2xl border border-black/10 bg-black/[0.02] p-3 text-xs text-black/60">
              Nota: ogni estrazione è indipendente. Nessuna statistica o
              “strategia” può garantire vincite.
            </div>
          </div>
        ),
      },
      {
        key: "groups",
        title: "1) Gruppi",
        anchor: "groups",
        placement: "right",
        body: (
          <div className="text-sm text-black/70 leading-relaxed">
            Crea un <b>gruppo</b> per separare giocate diverse (es. “Sabato”,
            “Natale”).
            {groupsCount === 0 ? (
              <div className="mt-3 rounded-2xl border border-black/10 bg-black/[0.02] p-3 text-xs text-black/70">
                👇 Crea almeno <b>1 gruppo</b> per continuare il tutorial.
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-black/10 bg-emerald-50 p-3 text-xs text-emerald-900">
                ✅ Perfetto. Ora puoi continuare.
              </div>
            )}
          </div>
        ),
      },
      {
        key: "generate",
        title: "2) Genera / Importa",
        anchor: "panel-generate",
        placement: "left",
        body: (
          <div className="text-sm text-black/70 leading-relaxed">
            Qui generi sestine <b>casuali</b> o importi da file.
            <div className="mt-2 text-xs text-black/60">
              L’app evita duplicati perfetti dentro lo stesso gruppo.
            </div>
          </div>
        ),
      },
      {
        key: "play",
        title: "3) Gioca",
        anchor: "panel-play",
        placement: "left",
        body: (
          <div className="text-sm text-black/70 leading-relaxed">
            La sezione <b>Gioca</b> ti guida una sestina alla volta e copia
            negli appunti.
            <div className="mt-2 text-xs text-black/60">
              È la parte “pratica” per compilare velocemente la schedina online.
            </div>
          </div>
        ),
      },
      {
        key: "validate",
        title: "4) Valida",
        anchor: "panel-validate",
        placement: "left",
        body: (
          <div className="text-sm text-black/70 leading-relaxed">
            In <b>Valida</b> inserisci l’estrazione e l’app ti dice se, tra le
            tue sestine, c’è un match (3/4/5/6).
            <div className="mt-2 text-xs text-black/60">
              Utile per verificare rapidamente tanti ticket.
            </div>
          </div>
        ),
      },
      {
        key: "win",
        title: "5) Vinci",
        anchor: "panel-prizes",
        placement: "left",
        body: (
          <div className="text-sm text-black/70 leading-relaxed">
            In <b>Vinci</b> trovi una lettura “umana”: riepilogo risultati,
            migliore match, e (se presente) timeline.
            <div className="mt-2 text-xs text-black/60">
              È la vista “finale” dopo una validazione.
            </div>
          </div>
        ),
      },
      {
        key: "settings",
        title: "6) Impostazioni",
        anchor: "panel-settings",
        placement: "left",
        body: (
          <div className="text-sm text-black/70 leading-relaxed">
            In <b>Impostazioni</b> cambi le regole di visualizzazione e
            preferenze (UI, export, ecc.).
            <div className="mt-2 text-xs text-black/60">
              Se qualcosa “non torna”, spesso è qui.
            </div>
          </div>
        ),
      },
    ],
    [groupsCount],
  );

  const [idx, setIdx] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [anchorRect, setAnchorRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (steps[idx]?.key === "groups" && groupsCount > 0) {
      const t = window.setTimeout(() => next(), 350);
      return () => window.clearTimeout(t);
    }
  }, [open, idx, groupsCount]);

  // reset quando apri
  useEffect(() => {
    if (!open) return;
    setIdx(0);
    setDontShowAgain(true);
  }, [open]);

  // aggiorna posizione tooltip
  useEffect(() => {
    if (!open) return;

    function compute() {
      const step = steps[idx];

      if (step.key === "intro") {
        setPos(null);
        return;
      }
      const els = findAnchors(step.anchor);
      const el = els[0] ?? null;
      if (!el) {
        setPos({ left: 16, top: 16 });
        setAnchorRect(null);
        return;
      }

      const rs = els.map((node) => node.getBoundingClientRect());
      const left0 = Math.min(...rs.map((r) => r.left));
      const top0 = Math.min(...rs.map((r) => r.top));
      const right0 = Math.max(...rs.map((r) => r.right));
      const bottom0 = Math.max(...rs.map((r) => r.bottom));
      // padding extra attorno al target (così “respira”)
      const pad = 10;
      const left = Math.max(8, left0 - pad);
      const top = Math.max(8, top0 - pad);
      const right = Math.min(window.innerWidth - 8, right0 + pad);
      const bottom = Math.min(window.innerHeight - 8, bottom0 + pad);

      setAnchorRect({
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      });

      const placement = step.placement ?? "right";
      setPos(getTooltipPos(el, placement));
    }

    function schedule() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    }

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, idx, steps]);

  if (!open) return null;

  const step = steps[idx];
  const needsGroup = step.key !== "intro"; // tutto dopo intro richiede almeno 1 gruppo
  const hasGroup = groupsCount > 0;
  const blocked = needsGroup && !hasGroup;
  const isIntro = step.key === "intro";
  const isLast = idx === steps.length - 1;

  function markDoneAndClose() {
    if (dontShowAgain) localStorage.setItem(fullStorageKey, "1");
    onClose();
  }

  function next() {
    // opzionale: se vuoi forzare un tab per far vedere l'anchor, puoi farlo qui
    const n = Math.min(steps.length - 1, idx + 1);
    const nextStep = steps[n];
    if (nextStep.key.startsWith("tab-")) {
      // no-op
    }
    // Se tu vuoi “aprire” il tab prima di mostrare il tooltip:
    if (onRequestTab) {
      if (nextStep.key === "play") onRequestTab("play");
      if (nextStep.key === "validate") onRequestTab("validate");
      if (nextStep.key === "win") onRequestTab("prizes");
      if (nextStep.key === "settings") onRequestTab("settings");
      if (nextStep.key === "groups" || nextStep.key === "generate")
        onRequestTab("generate");
    }
    setIdx(n);
  }

  function back() {
    setIdx((v) => Math.max(0, v - 1));
  }

  // overlay + highlight box (se non intro)
  return createPortal(
    <div className="fixed inset-0 z-[99999] pointer-events-none">
      {/* Spotlight overlay (con buco) */}
      {!isIntro && anchorRect ? (
        <>
          {/* sopra */}
          <div
            className="absolute bg-black/60 pointer-events-none"
            style={{ left: 0, top: 0, width: "100%", height: anchorRect.top }}
          />
          {/* sotto */}
          <div
            className="absolute bg-black/60 pointer-events-none"
            style={{
              left: 0,
              top: anchorRect.top + anchorRect.height,
              width: "100%",
              height: `calc(100% - ${anchorRect.top + anchorRect.height}px)`,
            }}
          />
          {/* sinistra */}
          <div
            className="absolute bg-black/60 pointer-events-none"
            style={{
              left: 0,
              top: anchorRect.top,
              width: anchorRect.left,
              height: anchorRect.height,
            }}
          />
          {/* destra */}
          <div
            className="absolute bg-black/60 pointer-events-none"
            style={{
              left: anchorRect.left + anchorRect.width,
              top: anchorRect.top,
              width: `calc(100% - ${anchorRect.left + anchorRect.width}px)`,
              height: anchorRect.height,
            }}
          />

          {/* Ring / glow attorno al target */}
          <div
            className="absolute rounded-3xl pointer-events-none"
            style={{
              left: anchorRect.left,
              top: anchorRect.top,
              width: anchorRect.width,
              height: anchorRect.height,
              boxShadow:
                "0 0 0 2px rgba(255,255,255,0.9), 0 10px 30px rgba(0,0,0,0.25), 0 0 0 8px rgba(255,255,255,0.15)",
            }}
          />
        </>
      ) : (
        // fallback: overlay uniforme (intro o anchor mancante)
        <div className="absolute inset-0 bg-black/60 pointer-events-none" />
      )}

      {/* blocca il background solo durante l'intro */}
      {isIntro ? (
        <div className="absolute inset-0 pointer-events-auto" />
      ) : null}

      {/* Intro card centrata */}
      {isIntro ? (
        <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-auto">
          <div className="w-full max-w-xl rounded-3xl border border-black/10 bg-white shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-black/10">
              <div className="text-xs text-black/60">Onboarding</div>
              <div className="text-2xl font-black">{step.title}</div>
            </div>

            <div className="p-5">{step.body}</div>

            <div className="px-5 pb-5 flex items-center justify-between gap-3">
              <label className="text-xs text-black/60 inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                />
                Non mostrarlo più
              </label>

              <div className="flex items-center gap-2">
                <button
                  className="px-4 py-2 rounded-2xl border border-black/10 bg-white font-extrabold hover:bg-black/[0.03]"
                  onClick={markDoneAndClose}
                >
                  Chiudi
                </button>
                <button
                  className="px-4 py-2 rounded-2xl border border-black/10 bg-black text-white font-extrabold hover:bg-black/90"
                  onClick={next}
                >
                  Ho capito, iniziamo →
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Tooltip per step 1..n */}
      {!isIntro && pos ? (
        <div
          className="absolute pointer-events-auto"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="w-[360px] rounded-3xl border border-black/10 bg-white shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-black/10">
              <div className="text-xs text-black/60">
                Step {idx} / {steps.length - 1}
              </div>
              <div className="text-lg font-black">{step.title}</div>
            </div>

            <div className="p-4">{step.body}</div>

            <div className="p-4 pt-0 flex items-center justify-between gap-2">
              <button
                className={cn(
                  "px-4 py-2 rounded-2xl border font-extrabold",
                  idx === 1
                    ? "border-black/10 bg-black/5 text-black/40 cursor-not-allowed"
                    : "border-black/10 bg-white hover:bg-black/[0.03]",
                )}
                disabled={idx === 1}
                onClick={back}
              >
                ← Indietro
              </button>

              <div className="flex items-center gap-2">
                <button
                  className="px-4 py-2 rounded-2xl border border-black/10 bg-white font-extrabold hover:bg-black/[0.03]"
                  onClick={markDoneAndClose}
                >
                  Salta
                </button>

                <button
                  className={cn(
                    "px-4 py-2 rounded-2xl border font-extrabold",
                    blocked
                      ? "border-black/10 bg-black/5 text-black/40 cursor-not-allowed"
                      : "border-black/10 bg-black text-white hover:bg-black/90",
                  )}
                  disabled={blocked}
                  onClick={() => (isLast ? markDoneAndClose() : next())}
                >
                  {blocked
                    ? "Crea un gruppo per continuare"
                    : isLast
                      ? "Fine"
                      : "Avanti →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

// helper: da chiamare in App per decidere se mostrare onboarding
export function shouldShowOnboarding(
  storageKey = "sextina_onboarding_done",
  version = "v1",
) {
  const k = `${storageKey}:${version}`;
  return !localStorage.getItem(k);
}
