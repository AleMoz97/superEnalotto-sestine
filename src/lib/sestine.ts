// src/lib/sestine.ts
import type { RNG } from "./rng";

export type SestinaNums = number[]; // length=6, ordinata crescente
export type Sestina = {
  nums: SestinaNums;
  key: string;
  createdAt: string;
  frozen: boolean;
  meta?: {
    seed?: string;
    attemptNonce?: number;
    superstitionMode?: boolean;
  };
};

export const MIN_NUM = 1;
export const MAX_NUM = 90;

export type Constraints = {
  exclude: number[];        // mai presenti
  mustInclude: number[];    // devono essere tutti presenti
  mustIncludeAnyOf: number[]; // almeno uno tra questi (opzionale)
};

export function normalizeNums(nums: number[]): SestinaNums {
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted as SestinaNums;
}

export function sestinaKey(nums: number[]): string {
  return normalizeNums(nums).join("-");
}

export function rngInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function isValidSestina(nums: number[], c: Constraints): boolean {
  const set = new Set(nums);

  for (const ex of c.exclude) if (set.has(ex)) return false;
  for (const mi of c.mustInclude) if (!set.has(mi)) return false;

  if (c.mustIncludeAnyOf.length > 0) {
    let ok = false;
    for (const x of c.mustIncludeAnyOf) if (set.has(x)) { ok = true; break; }
    if (!ok) return false;
  }

  return true;
}

export function generateRandomSestinaWithConstraints(
  rng: RNG,
  constraints: Constraints
): SestinaNums {
  // Strategia: prima metti i mustInclude, poi completa evitando exclude e duplicati interni
  const picked = new Set<number>();

  for (const n of constraints.mustInclude) picked.add(n);

  // Se i mustInclude sono > 6 è impossibile
  if (picked.size > 6) throw new Error("Vincolo impossibile: troppi numeri obbligatori (>6).");

  // Completa fino a 6
  let guard = 0;
  while (picked.size < 6) {
    guard++;
    if (guard > 100_000) throw new Error("Impossibile soddisfare i vincoli (loop).");

    const x = rngInt(rng, MIN_NUM, MAX_NUM);
    if (picked.has(x)) continue;
    if (constraints.exclude.includes(x)) continue;
    picked.add(x);
  }

  const nums = normalizeNums([...picked]);

  if (!isValidSestina(nums, constraints)) {
    // raro: può fallire con mustIncludeAnyOf se non è stato soddisfatto
    // rigenera in quel caso
    return generateRandomSestinaWithConstraints(rng, constraints);
  }

  return nums;
}

export function generateUniqueSestine(
  count: number,
  existingKeys: Set<string>,
  rngFactory: (nonce: number) => RNG,
  constraints: Constraints,
  options?: { seed?: string; superstitionMode?: boolean }
): Sestina[] {
  const out: Sestina[] = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    let nonce = 0;
    let ok = false;

    while (!ok) {
      const rng = rngFactory(nonce);
      const nums = generateRandomSestinaWithConstraints(rng, constraints);
      const key = sestinaKey(nums);

      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        out.push({
          nums,
          key,
          createdAt: new Date(now.getTime() + i).toISOString(),
          frozen: false,
          meta: {
            seed: options?.seed,
            attemptNonce: nonce,
            superstitionMode: options?.superstitionMode,
          },
        });
        ok = true;
      } else {
        nonce++;
        if (nonce > 50_000) {
          throw new Error("Impossibile generare sestine uniche: troppi duplicati (limite nonce).");
        }
      }
    }
  }

  return out;
}
