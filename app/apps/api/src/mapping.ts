export const PAGES = ['major', 'minor', 'common', 'paper', 'boiler'] as const;
export type Page = (typeof PAGES)[number];
export const isPage = (x: unknown): x is Page => PAGES.includes(x as Page);

export const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/** Default group -> Command Center page, inferred from the Rev.I summary block. null = needs a human decision. */
export function suggestPage(name: string): Page | null {
  const n = name.toUpperCase();
  if (/^COMMON\b/.test(n)) return 'common';
  if (/^PAPER\b/.test(n)) return 'paper';
  if (/^POWER BOILER/.test(n)) return 'boiler';
  if (/PULP-1|SHEETING-1|EVAPORATOR-2|RECOVERY BOILER-1|TURBINE GENERATOR-1|CAUSTICIZER-[13]\b|LIME KILN-[13]\b/.test(n)) return 'major';
  if (/PULP-2|SHEETING-2|CHEMICAL|EVAPORATOR-1|RECOVERY BOILER-2|SUPER CONCENTRATOR|DEMIN-2|CAUSTICIZER-2|LIME KILN-2|TURBINE GENERATOR-2/.test(n)) return 'minor';
  return null;
}
