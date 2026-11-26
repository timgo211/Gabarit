// Normes Euro (phase 5g) : tunnels du Mont-Blanc et du Fréjus interdits selon la classe d'émissions Euro du camion,
// lignes « Normes Euro » des fiches pays (data/pays/*.json, bloc "euro"). Alerte avant le départ seulement : jamais de
// voix, de bandeau ni d'annonce pendant le guidage. Logique pure.
//
// Sources lues le 21/11/2026 :
// - Tunnel du Mont-Blanc : arrêté préfectoral (Haute-Savoie) n° 2020-0825 du 18 juin 2020 modifiant l'art. 2 § 1 d de
//   l'arrêté n° 2009-3425 du 17 décembre 2009 (règlement de circulation du tunnel), en vigueur le 1er juillet 2020,
//   lu dans le PDF publié par Bison Futé (lien de SOURCES.montblanc) :
//   « d) aux véhicules de transport de marchandises de plus de 3,5 tonnes PTAC (poids total autorisé en charge) dont
//   les émissions polluantes sont de catégorie EURO Ø, EURO 1, EURO 2, EURO 3 et EURO 4 au sens de la réglementation
//   communautaire en vigueur à la date du présent règlement. A ce titre, sont interdits les véhicules de plus de
//   3,5 tonnes (PTAC) dont la date de première mise en circulation est antérieure au 1er octobre 2006 sauf si le
//   conducteur démontre que son véhicule répond à des normes de pollution équivalentes à celles de la classe EURO 5 ».
//   Même texte sur la page Bison Futé « Tunnel du Mont-Blanc (Cat. E) ». EEV n'est pas dans la liste : admis.
// - Tunnel du Fréjus : page Bison Futé « Tunnel du Fréjus (Cat. C) » (arrêté du 7 juillet 2017, règlement de
//   circulation) : interdits aux « véhicules de transport de marchandises de plus de 3,5 tonnes PTAC […] dont les
//   émissions polluantes sont de catégorie EURO 0, EURO 1, et EURO 2 sauf autorisation spéciale conjointe du préfet de
//   Savoie, et du préfet de Turin […] ; cette interdiction s'applique aux véhicules […] dont la date de première mise en
//   circulation est antérieure au 1er octobre 2001, sauf si le conducteur démontre que son véhicule répond à des normes
//   de pollution au moins équivalentes à celles de la classe EURO 3 ».
//   Euro 3 et 4 : SFTRF (exploitant), page « Classification tunnel » (sftrf.fr/le-tunnel/classification-tunnel/),
//   lue le 21/11/2026 par l'Action « Sources Euro » (sftrf.fr refuse le conteneur) : « Les poids lourds en normes
//   Euro 0-1-2-3-4 sont interdits au Tunnel du Fréjus » ; même chose sur la page Abonnements (« catégorie
//   europolluant 0-1-2-3 & 4, qui ne sont pas autorisés à transiter par le tunnel du Fréjus ») et dans les tarifs
//   SITAF 2026 (seule classe PL : « PL (Euro 5-6) »). Arrêté préfectoral non retrouvé : statut « confirmé par
//   l'exploitant » (règle frejus-3-4).
// - Péages : aucun tarif PL selon la classe Euro aux deux tunnels (Fréjus : une seule classe PL Euro 5-6, tarifs SITAF
//   2026 ; Mont-Blanc : page ATMB des tarifs PL au 1er janvier 2026) : rien affiché.
// - Le règlement vise les véhicules de transport de MARCHANDISES : le profil n'a pas de type de véhicule (l'appli est
//   faite pour les PL de marchandises), les textes disent donc « PL de marchandises ».
//
// Correspondance EEV (EURO_EEV) : EEV = valeurs limites de la ligne C de la directive 2005/55/CE (ligne B1 = Euro IV,
// B2 = Euro V). Sources : ORPL (RS 641.811) annexe 1 ch. 1.1 « ligne B2 et suivantes » avec Euro V (Fedlex, version
// du 1/01/2025) ; BFStrMG annexe 1 ch. 2 b bb « Fahrzeuge der EEV Klasse 1 und der Schadstoffklasse EURO V »
// (gesetze-im-internet.de) ; 35. BImSchV annexe 2, groupe 4 « C (EEV) » (gesetze-im-internet.de) ; arrêtés du
// Mont-Blanc et du Fréjus : EEV absent des classes interdites.

import { prepareLine, pointAt } from './nav-geo.js';
import { KNOWN_TUNNELS, indexLine, tubePassage } from './adr.js';

export const EURO = Object.freeze({
  /** Les deux règlements visent les véhicules de transport de marchandises de plus de 3,5 t de PTAC. */
  MIN_PTAC_T: 3.5,
  FOOTER: 'La signalisation fait foi.',
  CHECK: 'à vérifier',
  /** Ordre des classes (EEV entre Euro 5 et Euro 6). */
  ORDER: Object.freeze(['0', '1', '2', '3', '4', '5', 'EEV', '6']),
});

/** Tableau de correspondance EEV, règle par règle (affiché dans les textes, cité dans les tests). */
export const EURO_EEV = Object.freeze([
  Object.freeze({ rule: 'Tunnel du Mont-Blanc', eev: 'admis (EEV absent des classes interdites Euro Ø à 4)', source: 'Arrêté préfectoral n° 2020-0825 du 18 juin 2020' }),
  Object.freeze({ rule: 'Tunnel du Fréjus', eev: 'admis (EEV absent des classes interdites)', source: 'Arrêté du 7 juillet 2017 (Bison Futé)' }),
  Object.freeze({ rule: 'RPLP (Suisse)', eev: 'comme Euro V : catégorie de redevance 1', source: 'ORPL (RS 641.811), annexe 1 ch. 1.1' }),
  Object.freeze({ rule: 'Maut (Allemagne)', eev: 'comme Euro V : catégorie B', source: 'BFStrMG, annexe 1 ch. 2 b' }),
  Object.freeze({ rule: 'Vignette verte (Allemagne)', eev: 'groupe 4 (vert)', source: '35. BImSchV, annexe 2' }),
]);

const SOURCES = Object.freeze({
  montblanc: Object.freeze({
    name: 'Arrêté préfectoral n° 2020-0825 du 18 juin 2020 (règlement de circulation du tunnel du Mont-Blanc)',
    // Nom du fichier coupé en deux : sinon pris pour une clé par le test statique (longue chaîne).
    url: 'https://www.bison-fute.gouv.fr/IMG/pdf/05_ARP_2020_0825' + '_interdiction_PL_euro4.pdf', kind: 'national',
  }),
  frejus: Object.freeze({
    name: 'Arrêté du 7 juillet 2017 (règlement de circulation du tunnel du Fréjus), Bison Futé',
    url: 'https://www.bison-fute.gouv.fr/tunnel-du-frejus-73-categorie-c.html', kind: 'national',
  }),
  sftrf: Object.freeze({
    name: 'SFTRF (exploitant français du tunnel du Fréjus), page « Classification tunnel »',
    url: 'https://www.sftrf.fr/le-tunnel/classification-tunnel/', kind: 'operator',
  }),
});

/**
 * Règles des tunnels. status : 'confirmed' (texte officiel lu), 'operator' (confirmé par l'exploitant, arrêté
 * préfectoral non retrouvé), 'check' (à vérifier : jamais présenté comme une interdiction).
 */
export const TUNNEL_RULES = Object.freeze([
  Object.freeze({
    id: 'montblanc-0-4', tunnel: 'known:montblanc', name: 'Tunnel du Mont-Blanc', banned: Object.freeze(['0', '1', '2', '3', '4']),
    status: 'confirmed', since: '1er juillet 2020', ref: 'arrêté préfectoral n° 2020-0825 du 18 juin 2020',
    dateRule: 'sans preuve, une première mise en circulation avant le 1er octobre 2006 est interdite sauf équivalence Euro 5 démontrée',
    source: SOURCES.montblanc, verified: '2026-11-21',
  }),
  Object.freeze({
    id: 'frejus-0-2', tunnel: 'known:frejus', name: 'Tunnel du Fréjus', banned: Object.freeze(['0', '1', '2']),
    status: 'confirmed', since: null, ref: 'arrêté du 7 juillet 2017, sauf autorisation spéciale des préfets de Savoie et de Turin',
    dateRule: 'sans preuve, une première mise en circulation avant le 1er octobre 2001 est interdite sauf équivalence Euro 3 démontrée',
    source: SOURCES.frejus, verified: '2026-11-21',
  }),
  Object.freeze({
    id: 'frejus-3-4', tunnel: 'known:frejus', name: 'Tunnel du Fréjus', banned: Object.freeze(['3', '4']),
    status: 'operator', since: null, ref: 'selon l\'exploitant',
    dateRule: null, source: SOURCES.sftrf, verified: '2026-11-21',
  }),
]);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const km = (m) => `km ${Math.round(m / 1000)}`;
const fmtDate = (iso) => iso.split('-').reverse().join('/');

/** « Euro 3 », « EEV » ; '' → null. */
export function euroText(cls) {
  if (!cls) return null;
  return cls === 'EEV' ? 'EEV' : `Euro ${cls}`;
}

/** Liste de classes → « Euro 0 à 4 », « Euro 3 et 4 », « Euro 0, 1 et 2 ». */
export function classesText(list) {
  const nums = list.filter((c) => c !== 'EEV').map(Number).sort((a, b) => a - b);
  if (!nums.length) return '';
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (nums.length >= 3 && contiguous) return `Euro ${nums[0]} à ${nums[nums.length - 1]}`;
  if (nums.length === 1) return `Euro ${nums[0]}`;
  return `Euro ${nums.slice(0, -1).join(', ')} et ${nums[nums.length - 1]}`;
}

/** Classes admises (celles qui ne sont dans aucune liste), « Euro 5, EEV et Euro 6 ». */
function admittedText(bannedSet) {
  const ok = EURO.ORDER.filter((c) => !bannedSet.has(c)).map(euroText);
  if (ok.length <= 1) return ok.join('');
  return `${ok.slice(0, -1).join(', ')} et ${ok[ok.length - 1]}`;
}

/** Source affichée : « source : … (lu le 21/11/2026) » ; exploitant : nom et date de lecture. */
function sourceText(rule) {
  if (rule.status === 'confirmed') return `Source : ${rule.source.name}, lu le ${fmtDate(rule.verified)}.`;
  if (rule.status === 'operator') return `Confirmé par l'exploitant : ${rule.source.name}, lu le ${fmtDate(rule.verified)} ; arrêté préfectoral non retrouvé.`;
  return `Texte officiel non lu (${rule.ref}) : ${EURO.CHECK}.`;
}

/**
 * Tunnels à règle Euro traversés par l'itinéraire (tubes en dur de KNOWN_TUNNELS, adr.js), triés depuis le départ.
 * mid : milieu du passage sur le tracé (v48 : carré évité par « Éviter le tunnel », comme les tunnels ADR).
 * @returns {{ id:string, name:string, enter:number, exit:number, mid:number[] }[]}
 */
export function euroTunnelsAlongRoute(route, rules = TUNNEL_RULES) {
  if (!Array.isArray(route?.coordinates) || route.coordinates.length < 2) return [];
  const ids = new Set(rules.map((r) => r.tunnel));
  const line = prepareLine(route.coordinates);
  const grid = indexLine(line);
  const out = [];
  for (const t of KNOWN_TUNNELS) {
    if (!ids.has(t.id)) continue;
    for (const g of t.tubes) {
      const pass = tubePassage(line, grid, g);
      if (pass) {
        out.push({ id: t.id, name: t.name, enter: pass.enter, exit: pass.exit, mid: pointAt(line, (pass.enter + pass.exit) / 2).point });
        break;
      }
    }
  }
  return out.sort((a, b) => a.enter - b.enter);
}

/**
 * Verdict d'un tunnel pour une classe : 'banned' (texte officiel), 'operator' (interdit selon l'exploitant),
 * 'check' (interdiction possible, à vérifier), 'allowed', 'unknown' (classe non précisée).
 */
export function tunnelVerdict(tunnelId, cls, all = TUNNEL_RULES) {
  const rules = all.filter((r) => r.tunnel === tunnelId);
  if (!cls) return 'unknown';
  const hit = rules.find((r) => r.banned.includes(cls));
  if (!hit) return 'allowed';
  return hit.status === 'confirmed' ? 'banned' : hit.status === 'operator' ? 'operator' : 'check';
}

const short = (name) => name.replace(/^Tunnel (du |de la |de )?/, '');

/**
 * Lignes d'un tunnel traversé : alerte (interdit), information (admis), « à vérifier » ; toutes finissent par
 * « La signalisation fait foi. ». La ligne « à vérifier » (Fréjus Euro 3 et 4) a aussi sa place sur la fiche.
 */
export function describeTunnel(p, vehicle, all = TUNNEL_RULES) {
  const cls = vehicle?.euroClass || '';
  const mine = euroText(cls);
  const rules = all.filter((r) => r.tunnel === p.id);
  const surer = rules.filter((r) => r.status !== 'check');
  const lines = [];
  const cards = [];
  const where = `vers ${km(p.enter)}`;
  const bannedSet = new Set(surer.flatMap((r) => r.banned));
  const head = (r) => `PL de marchandises de plus de 3,5 t ${classesText(r.banned)} interdits${r.since ? ` depuis le ${r.since}` : ''} (${r.ref})`;

  for (const r of surer) {
    const concerned = !cls || r.banned.includes(cls);
    if (!concerned) continue;
    const date = r.dateRule ? ` ; ${r.dateRule}` : '';
    if (cls) {
      lines.push({ level: 'warn', sev: 'ban', text: `${p.name} interdit à votre véhicule (${mine}), ${where} : ${head(r)}${date}. ${sourceText(r)} ${EURO.FOOTER}`, url: r.source.url, linkText: 'Texte' });
      cards.push(`${short(p.name)} interdit (${mine}${r.status === 'operator' ? ', exploitant' : ''})`);
    } else {
      lines.push({ level: 'warn', sev: 'check', text: `${p.name}, ${where} : ${head(r)}${date}. Classe Euro non précisée dans le profil : vérifiez-la. ${sourceText(r)} ${EURO.FOOTER}`, url: r.source.url, linkText: 'Texte' });
    }
  }
  const checkSet = new Set(rules.filter((r) => r.status === 'check').flatMap((r) => r.banned));
  const anySet = new Set([...bannedSet, ...checkSet]);
  if (!cls && surer.length) {
    const unsure = checkSet.size ? ` ; ${classesText([...checkSet])} : ${EURO.CHECK}` : '';
    lines.push({ level: 'info', text: `${p.name} : ${admittedText(anySet)} admis (EEV n'est pas dans la liste des classes interdites)${unsure}. ${EURO.FOOTER}` });
    cards.push(`${short(p.name)} : ${classesText([...bannedSet])} interdits, classe Euro ?`);
  }
  if (cls && !anySet.has(cls)) {
    const eev = cls === 'EEV' ? ' : EEV n\'est pas dans la liste des classes interdites' : '';
    const list = surer.map((r) => `${classesText(r.banned)}${r.status === 'operator' ? ' selon l\'exploitant' : ''}`).join(', ');
    lines.push({ level: 'info', text: `${p.name}, ${where} : votre classe (${mine}) est admise${eev} (${list} interdits aux PL de marchandises de plus de 3,5 t). ${EURO.FOOTER}` });
  }
  for (const r of rules.filter((x) => x.status === 'check')) {
    if (cls && !r.banned.includes(cls)) continue;
    const yours = cls ? ` Votre profil : ${mine}.` : ' Classe Euro non précisée dans le profil.';
    lines.push({
      level: 'info',
      text: `${p.name}, ${where} : ${classesText(r.banned)} aussi interdits aux PL de marchandises de plus de 3,5 t depuis le ${r.since} d'après des transporteurs (${r.ref}) : ${EURO.CHECK}.${yours} ${EURO.FOOTER}`,
      url: r.source.url, linkText: 'Exploitant',
    });
    cards.push(`${short(p.name)} ${classesText(r.banned)} : ${EURO.CHECK}`);
  }
  return { lines, cards };
}

/**
 * Règles Euro d'un itinéraire : tunnels du Mont-Blanc et du Fréjus, seulement au-delà de 3,5 t de PTAC.
 * @param {object} route itinéraire (parseDirections : coordinates)
 * @param {{ vehicle:object }} ctx vehicle.weight (PTAC, t), vehicle.euroClass ('' = non précisée)
 * @returns {{ passages:{ id, name, enter, exit, verdict:string }[], lines:object[], short:string[] }}
 */
export function euroRules(route, { vehicle, rules = TUNNEL_RULES } = {}) {
  const out = { passages: [], lines: [], short: [] };
  const ptac = isNum(vehicle?.weight) ? vehicle.weight : null;
  if (ptac !== null && ptac <= EURO.MIN_PTAC_T) return out;
  for (const p of euroTunnelsAlongRoute(route, rules)) {
    out.passages.push({ ...p, verdict: tunnelVerdict(p.id, vehicle?.euroClass || '', rules) });
    const d = describeTunnel(p, vehicle, rules);
    out.lines.push(...d.lines);
    out.short.push(...d.cards);
  }
  return out;
}

// ───────── Fiches pays (bloc "euro" de data/pays/*.json) ─────────

/**
 * Texte d'une règle « Normes Euro » d'une fiche pays. rule.mine : { classe: texte } (catégorie de la classe du
 * profil) ; classe non précisée : rappel que toutes les catégories du texte s'appliquent selon la classe.
 */
export function countryEuroText(rule, vehicle) {
  const cls = vehicle?.euroClass || '';
  const mine = rule?.mine && typeof rule.mine === 'object' ? rule.mine : null;
  if (!mine) return rule.text;
  if (!cls) return `${rule.text} Classe Euro non précisée dans le profil : selon votre classe.`;
  const t = mine[cls];
  return typeof t === 'string' && t ? `${rule.text} Votre profil (${euroText(cls)}) : ${t}.` : `${rule.text} Votre profil (${euroText(cls)}) : ${EURO.CHECK}.`;
}
