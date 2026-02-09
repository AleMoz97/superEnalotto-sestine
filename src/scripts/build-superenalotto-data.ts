import * as fs from "node:fs";
import * as path from "node:path";

type Draw = {
    date: string; // YYYY-MM-DD
    year: number;
    conc: number | null;
    numbers_raw?: Array<number | null>;
    numbers: number[];
    jolly: number | null;
    superstar?: number | null;
    source_url?: string;
};

type Input = {
    schema_version: number;
    draws: Draw[];
};

function ensureDir(p: string) {
    fs.mkdirSync(p, { recursive: true });
}

function readJson<T>(p: string): T {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function writeJson(p: string, obj: unknown) {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
}

function clampNumber(n: unknown): number | null {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return n;
}

function normalizeDraw(d: Draw): Draw {
    // garantisci numbers come array di numeri 1..90
    const nums = Array.isArray(d.numbers) ? d.numbers : [];
    const numbers = nums
        .map(clampNumber)
        .filter((x): x is number => typeof x === "number")
        .filter((x) => x >= 1 && x <= 90);

    const jolly = clampNumber(d.jolly);
    const year =
        typeof d.year === "number" && Number.isFinite(d.year)
            ? d.year
            : Number(d.date?.slice(0, 4));

    return {
        ...d,
        year,
        numbers,
        jolly: jolly != null && jolly >= 1 && jolly <= 90 ? jolly : null,
    };
}

function sum(arr: number[]) {
    let s = 0;
    for (const x of arr) s += x;
    return s;
}

function isEven(n: number) {
    return n % 2 === 0;
}

function isLow(n: number) {
    return n <= 45;
}

function makeFreqArray() {
    // index 0 unused
    return Array.from({ length: 91 }, () => 0);
}

function sortByDateConc(a: Draw, b: Draw) {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return (a.conc ?? 0) - (b.conc ?? 0);
}

const INPUT_PATH = path.resolve(process.cwd(), "superenalotto_franknet.json");

// Output in Vite public/
const OUT_BASE = path.resolve(process.cwd(), "..", "..", "public", "data");
const OUT_YEARS = path.join(OUT_BASE, "years");
const OUT_STATS = path.join(OUT_BASE, "stats");

type IndexJson = {
    schema_version: 1;
    generated_at: string;
    years: Array<{
        year: number;
        draws: number;
        first_date: string | null;
        last_date: string | null;
    }>;
    totals: {
        draws: number;
        first_date: string | null;
        last_date: string | null;
    };
};

type GlobalStats = {
    schema_version: 1;
    generated_at: string;
    totals: {
        draws: number;
        years: number;
    };

    // frequenze
    freq_numbers: number[]; // len 91, index=numero
    freq_jolly: number[];   // len 91

    // distribuzioni (istogrammi)
    dist_sum: Record<string, number>;         // somma -> count
    dist_even_count: Record<string, number>;  // 0..6 -> count (su draws con 6 numeri)
    dist_low_count: Record<string, number>;   // 0..6 -> count (<=45)

    // ripetizioni tra estrazioni consecutive (solo quando entrambe hanno 6 numeri)
    dist_repeat_next: Record<string, number>; // 0..6 -> count

    // top coppie
    top_pairs: Array<{ a: number; b: number; count: number }>;
};

function pairKey(a: number, b: number) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
}

async function main() {
    if (!fs.existsSync(INPUT_PATH)) {
        console.error(`❌ Input non trovato: ${INPUT_PATH}`);
        process.exit(1);
    }

    const input = readJson<Input>(INPUT_PATH);
    const rawDraws = Array.isArray(input.draws) ? input.draws : [];
    const draws = rawDraws.map(normalizeDraw).filter((d) => !!d.date && d.year);

    draws.sort(sortByDateConc);

    ensureDir(OUT_BASE);
    ensureDir(OUT_YEARS);
    ensureDir(OUT_STATS);

    // group by year
    const byYear = new Map<number, Draw[]>();
    for (const d of draws) {
        const y = d.year;
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(d);
    }

    const years = Array.from(byYear.keys()).sort((a, b) => a - b);

    // write per-year files
    const yearIndex: IndexJson["years"] = [];
    for (const y of years) {
        const list = byYear.get(y)!;
        list.sort(sortByDateConc);

        const outYear = {
            schema_version: 1,
            year: y,
            draws: list,
        };

        const outPath = path.join(OUT_YEARS, `${y}.json`);
        writeJson(outPath, outYear);

        yearIndex.push({
            year: y,
            draws: list.length,
            first_date: list[0]?.date ?? null,
            last_date: list[list.length - 1]?.date ?? null,
        });
    }

    const indexJson: IndexJson = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        years: yearIndex,
        totals: {
            draws: draws.length,
            first_date: draws[0]?.date ?? null,
            last_date: draws[draws.length - 1]?.date ?? null,
        },
    };

    writeJson(path.join(OUT_BASE, "index.json"), indexJson);

    // -------- GLOBAL STATS PRECOMPUTE --------
    const freqNumbers = makeFreqArray();
    const freqJolly = makeFreqArray();
    const distSum: Record<string, number> = {};
    const distEvenCount: Record<string, number> = {};
    const distLowCount: Record<string, number> = {};
    const distRepeatNext: Record<string, number> = {};

    const pairCounts = new Map<string, number>();

    function bump(map: Record<string, number>, k: number | string) {
        const kk = String(k);
        map[kk] = (map[kk] ?? 0) + 1;
    }

    // Pass 1: frequenze / somme / parità / low-high / coppie
    for (const d of draws) {
        for (const n of d.numbers) freqNumbers[n]++;

        if (d.jolly != null) freqJolly[d.jolly]++;

        if (d.numbers.length === 6) {
            bump(distSum, sum(d.numbers));

            const evenCount = d.numbers.reduce((acc, n) => acc + (isEven(n) ? 1 : 0), 0);
            bump(distEvenCount, evenCount);

            const lowCount = d.numbers.reduce((acc, n) => acc + (isLow(n) ? 1 : 0), 0);
            bump(distLowCount, lowCount);

            // coppie (15 per draw)
            const nums = [...d.numbers].sort((a, b) => a - b);
            for (let i = 0; i < nums.length; i++) {
                for (let j = i + 1; j < nums.length; j++) {
                    const k = pairKey(nums[i], nums[j]);
                    pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
                }
            }
        }
    }

    // Pass 2: ripetizioni tra draw consecutive (solo se entrambe 6 numeri)
    for (let i = 0; i < draws.length - 1; i++) {
        const a = draws[i];
        const b = draws[i + 1];
        if (a.numbers.length !== 6 || b.numbers.length !== 6) continue;
        const setA = new Set(a.numbers);
        let inter = 0;
        for (const n of b.numbers) if (setA.has(n)) inter++;
        bump(distRepeatNext, inter);
    }

    // Top pairs (es. top 50)
    const topPairs = Array.from(pairCounts.entries())
        .map(([k, count]) => {
            const [a, b] = k.split("-").map(Number);
            return { a, b, count };
        })
        .sort((x, y) => y.count - x.count)
        .slice(0, 50);

    const globalStats: GlobalStats = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        totals: {
            draws: draws.length,
            years: years.length,
        },
        freq_numbers: freqNumbers,
        freq_jolly: freqJolly,
        dist_sum: distSum,
        dist_even_count: distEvenCount,
        dist_low_count: distLowCount,
        dist_repeat_next: distRepeatNext,
        top_pairs: topPairs,
    };

    writeJson(path.join(OUT_STATS, "global.json"), globalStats);

    console.log("✅ Build data completed.");
    console.log(`→ ${path.join(OUT_BASE, "index.json")}`);
    console.log(`→ ${OUT_YEARS}/YYYY.json (${years.length} files)`);
    console.log(`→ ${path.join(OUT_STATS, "global.json")}`);
}

main().catch((e) => {
    console.error("❌ ERROR:", e);
    process.exit(1);
});
