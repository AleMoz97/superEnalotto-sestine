import * as fs from "node:fs";
import * as path from "node:path";
import * as cheerio from "cheerio";

type Draw = {
    date: string; // YYYY-MM-DD
    year: number;
    conc: number | null;
    jolly: number | null;

    // numeri “come trovati” (include null se c'è '--')
    numbers_raw: Array<number | null>;

    // numeri validi (solo numeri, pronto per stats)
    numbers: number[];

    source_url: string;
};

type Output = {
    schema_version: 1;
    game: "Franknet SuperEnalotto archive";
    scraped_at: string;
    source: {
        base_url: string;
        year_start: number;
        year_end: number;
        years_found: number[];
    };
    draws: Draw[];
};

const BASE = "https://www.franknet.altervista.org/superena";
const monthMap: Record<string, number> = {
    gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6,
    lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12,
};

function pad2(n: number) {
    return String(n).padStart(2, "0");
}
function toISODate(year: number, dd: number, mon: number) {
    return `${year}-${pad2(mon)}-${pad2(dd)}`;
}
function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text?: string }> {
    const res = await fetch(url, {
        headers: {
            "user-agent": "Mozilla/5.0 (compatible; superenalotto-scraper/1.0)",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    });

    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    return { ok: true, status: res.status, text };
}

/**
 * Estrae e parse tutte le righe dentro i <pre>.
 * Formato riga tipico:
 * 05 gen  51  82  01  20  62  56     44       1
 * Oppure con '--' (mancante):
 * 07 gen  --  15  63  36  72  42     29       1
 *
 * Strategia robusta:
 * - parse "dd mon"
 * - tokenizza il resto per spazi
 * - conc = ultimo token numerico
 * - jolly = token numerico prima del conc
 * - tutti i token prima di jolly sono "numeri estratti" (possono includere '--')
 */
function parseYearHtml(year: number, html: string, sourceUrl: string): Draw[] {
    const $ = cheerio.load(html);

    // prendo SOLO i <pre>, perché il body include toolbar altervista ecc.
    const preText = $("pre")
        .toArray()
        .map((el) => $(el).text())
        .join("\n");

    const lines = preText
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    const out: Draw[] = [];

    for (const line of lines) {
        // salta header tipo: "1871 1° 2° ..."
        if (line.startsWith(String(year))) continue;
        if (/^1°\b|^2°\b|Jolly|Conc\./i.test(line)) continue;

        // match data
        const m = line.match(/^(\d{1,2})\s+([a-z]{3})\s+(.*)$/i);
        if (!m) continue;

        const dd = Number(m[1]);
        const monStr = m[2].toLowerCase();
        const mon = monthMap[monStr];
        if (!mon || dd < 1 || dd > 31) continue;

        const rest = m[3].trim();
        if (!rest) continue;

        // tokenizza: numeri o '--'
        const tokens = rest.split(" ").filter(Boolean);

        // estrai tokens numerici (conc/jolly) dalla coda:
        // cerco ultimo token che sia numero = conc
        let conc: number | null = null;
        let jolly: number | null = null;

        const lastNumIdx = (() => {
            for (let i = tokens.length - 1; i >= 0; i--) {
                if (/^\d{1,4}$/.test(tokens[i])) return i;
            }
            return -1;
        })();

        if (lastNumIdx === -1) continue;
        conc = Number(tokens[lastNumIdx]);

        // jolly = numero precedente a conc
        const prevNumIdx = (() => {
            for (let i = lastNumIdx - 1; i >= 0; i--) {
                if (/^\d{1,4}$/.test(tokens[i])) return i;
            }
            return -1;
        })();

        if (prevNumIdx === -1) continue;
        jolly = Number(tokens[prevNumIdx]);

        // numeri estratti = tokens prima del jolly (prevNumIdx)
        const drawTokens = tokens.slice(0, prevNumIdx);

        // parse '--' => null, numeri => number
        const numbers_raw: Array<number | null> = drawTokens
            .filter((t) => t !== "") // safe
            .map((t) => {
                if (t === "--") return null;
                if (/^\d{1,4}$/.test(t)) return Number(t);
                return null; // qualunque roba strana la trasformo in null
            });

        const numbers = numbers_raw.filter((x): x is number => typeof x === "number");

        // validazione minima: almeno 5 numeri reali (come nei tuoi esempi antichi)
        if (numbers.length < 5) continue;

        out.push({
            date: toISODate(year, dd, mon),
            year,
            conc,
            jolly,
            numbers_raw,
            numbers,
            source_url: sourceUrl,
        });
    }

    // dedup + sort
    const seen = new Set<string>();
    const deduped: Draw[] = [];
    for (const d of out) {
        const k = `${d.date}|${d.conc ?? ""}|${d.jolly ?? ""}|${d.numbers_raw.join(",")}`;
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(d);
    }

    deduped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.conc ?? 0) - (b.conc ?? 0)));
    return deduped;
}

async function main() {
    // ✅ cambia questi due valori se vuoi restringere
    const startYear = 1871;
    const endYear = new Date().getFullYear(); // fino a oggi

    const yearsFound: number[] = [];
    const drawsAll: Draw[] = [];

    console.log(`Range: ${startYear} → ${endYear}`);

    for (let y = startYear; y <= endYear; y++) {
        const url = `${BASE}/${y}.HTM`;
        const res = await fetchText(url);

        if (!res.ok) {
            // 404/500 ecc: salto
            if (res.status !== 404) {
                console.warn(`⚠️ ${y}: HTTP ${res.status} (${url})`);
            }
            continue;
        }

        const html = res.text!;
        const parsed = parseYearHtml(y, html, url);

        if (parsed.length > 0) {
            yearsFound.push(y);
            drawsAll.push(...parsed);
            console.log(`✅ ${y}: ${parsed.length} righe`);
        } else {
            console.warn(`⚠️ ${y}: pagina ok ma 0 righe parsate (formato cambiato?)`);
        }

        // gentilezza verso il sito
        await sleep(150);
    }

    drawsAll.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.conc ?? 0) - (b.conc ?? 0)));

    const out: Output = {
        schema_version: 1,
        game: "Franknet SuperEnalotto archive",
        scraped_at: new Date().toISOString(),
        source: {
            base_url: BASE,
            year_start: startYear,
            year_end: endYear,
            years_found: yearsFound,
        },
        draws: drawsAll,
    };

    const outPath = path.resolve(process.cwd(), "../../public/superenalotto_franknet.json");
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");

    console.log(`\n🎉 DONE: years=${yearsFound.length} draws=${drawsAll.length}`);
    console.log(`→ ${outPath}`);
}

main().catch((e) => {
    console.error("❌ ERROR:", e);
    process.exit(1);
});
