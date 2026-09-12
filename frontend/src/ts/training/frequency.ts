import frequencies from "./data/english-sequence-frequency.json";

const perMillion: Readonly<Record<string, number>> = frequencies.perMillion;
const maxima: Readonly<Record<string, number>> = frequencies.maxPerMillion;

/** Frequency changes practice priority only, never measured accuracy. */
export function englishFrequencyMultiplier(target: string): number {
  if (!/^[a-z]{1,4}$/.test(target)) return 1;
  const frequency = perMillion[target] ?? 0;
  const maximum = maxima[String(target.length)] ?? 0;
  if (frequency <= 0 || maximum <= 0) return 1;
  // Log compression keeps very common sequences from dominating practice.
  return 1 + Math.min(1, Math.log1p(frequency) / Math.log1p(maximum));
}
