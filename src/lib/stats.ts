// src/lib/stats.ts
import type { Sestina } from "./sestine";
import { MIN_NUM, MAX_NUM } from "./sestine";

export function frequencyMap(sestine: Sestina[]): number[] {
    const freq = Array(MAX_NUM + 1).fill(0);
    for (const s of sestine) for (const n of s.nums) freq[n]++;
    return freq;
}

export function topNumbers(freq: number[], k = 10): { n: number; count: number }[] {
    const arr: { n: number; count: number }[] = [];
    for (let n = MIN_NUM; n <= MAX_NUM; n++) arr.push({ n, count: freq[n] });
    arr.sort((a, b) => b.count - a.count || a.n - b.n);
    return arr.slice(0, k);
}

export function missingNumbers(freq: number[]): number[] {
    const out: number[] = [];
    for (let n = MIN_NUM; n <= MAX_NUM; n++) if (freq[n] === 0) out.push(n);
    return out;
}
