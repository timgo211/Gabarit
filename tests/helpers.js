import { readFileSync } from 'node:fs';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

/** Fait rouler une suite de positions dans le moteur ; renvoie le dernier état et tous les événements datés. */
export function runFixes(updateNavigation, state, fixes) {
  const events = [];
  const views = [];
  let s = state;
  for (const f of fixes) {
    const r = updateNavigation(s, f);
    s = r.state;
    views.push(r.view);
    for (const e of r.events) events.push({ ...e, t: f.timestamp, view: r.view });
  }
  return { state: s, events, views };
}
