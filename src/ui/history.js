// Réglages › Historique des trajets (phase 6, v56) : liste, statistiques par mois, relevé imprimable (feuille de style
// d'impression, « Enregistrer en PDF » du navigateur), effacement. Textes et calculs : src/lib/trip-history.js ;
// stockage : src/ui/trip-history.js (IndexedDB). Aucune coordonnée n'est gardée ni affichée.

import { $, el } from './dom.js';
import { HISTORY, describeTrip, monthlyStats, monthText } from '../lib/trip-history.js';

/** Trajets affichés dans Réglages (le relevé imprimé les contient tous). */
const SHOWN = 30;

/** @param {{ store:{ list:()=>Promise<object[]|null>, clear:()=>Promise<boolean> } }} ctx */
export function createHistoryPanel(ctx) {
  const ui = {
    privacy: $('#history-privacy'), stats: $('#history-stats'), list: $('#history-list'), status: $('#history-status'),
    print: $('#btn-history-print'), clear: $('#btn-history-clear'), sheet: $('#history-print'),
  };
  ui.privacy.textContent = HISTORY.PRIVACY_TEXT;
  let trips = [];

  const row = (t) => {
    const d = describeTrip(t);
    return el('li', { class: 'history-trip' }, [
      el('span', { class: 'history-date', text: d.date }),
      el('span', { class: 'history-route', text: d.route }),
      d.stops ? el('span', { class: 'history-stops', text: d.stops }) : null,
      el('span', { class: 'history-facts', text: [d.km, d.duration, d.profile].filter(Boolean).join(' · ') }),
    ]);
  };

  async function refresh() {
    const list = await ctx.store.list();
    if (list === null) {
      trips = [];
      ui.status.textContent = HISTORY.UNAVAILABLE_TEXT;
    } else {
      trips = list;
      ui.status.textContent = list.length ? '' : HISTORY.EMPTY_TEXT;
    }
    ui.stats.replaceChildren(...monthlyStats(trips).map((m) => el('li', { text: monthText(m) })));
    ui.list.replaceChildren(...trips.slice(0, SHOWN).map(row));
    ui.print.disabled = !trips.length;
    ui.clear.disabled = !trips.length;
  }

  /** Relevé : tous les trajets, statistiques par mois ; seule partie imprimée (body.printing-history). */
  function fillSheet() {
    const head = ['Date', 'Départ → arrivée', 'Étapes', 'km', 'Durée', 'Profil'];
    ui.sheet.replaceChildren(
      el('h1', { text: HISTORY.PRINT_TITLE }),
      el('p', { text: `Édité le ${describeTrip({ date: new Date().toISOString(), from: '', to: '', stops: [], km: 0, duration: 0, profile: '' }).date}. ${HISTORY.PRIVACY_TEXT}` }),
      el('h2', { text: 'Par mois' }),
      el('ul', {}, monthlyStats(trips).map((m) => el('li', { text: monthText(m) }))),
      el('h2', { text: 'Trajets' }),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, head.map((h) => el('th', { text: h })))]),
        el('tbody', {}, trips.map((t) => {
          const d = describeTrip(t);
          return el('tr', {}, [d.date, d.route, t.stops.join(', '), d.km, d.duration, d.profile].map((v) => el('td', { text: v })));
        })),
      ]),
    );
  }

  ui.print.addEventListener('click', () => {
    if (!trips.length) return;
    fillSheet();
    document.body.classList.add('printing-history');
    const done = () => { document.body.classList.remove('printing-history'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } finally { setTimeout(done, 1000); }
  });

  ui.clear.addEventListener('click', async () => {
    if (!trips.length || !window.confirm('Effacer tout l\'historique des trajets de cet appareil ?')) return;
    const ok = await ctx.store.clear();
    ui.status.textContent = ok ? 'Historique effacé.' : HISTORY.UNAVAILABLE_TEXT;
    await refresh();
  });

  return { refresh };
}
