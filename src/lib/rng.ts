// src/lib/rng.ts
export type RNG = () => number; // [0,1)

function xfnv1a(str: string): () => number {
    // hash deterministico da stringa
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return () => {
        h += h << 13; h ^= h >>> 7;
        h += h << 3; h ^= h >>> 17;
        h += h << 5;
        return (h >>> 0) / 4294967296;
    };
}

export function mulberry32(seed: number): RNG {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function rngFromSeed(seed: string): RNG {
    // 1) hash string -> numero
    const h = xfnv1a(seed);
    const n = Math.floor(h() * 2 ** 32) >>> 0;
    return mulberry32(n);
}
