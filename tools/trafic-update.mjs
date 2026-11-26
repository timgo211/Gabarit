// Trafic (phase 10 A, PR 1) pour l'Action « Trafic » (.github/workflows/trafic.yml) : télécharge content.xml (événements
// du réseau routier national non concédé, DIR, Bison Futé, DATEX II v2, Licence Ouverte Etalab 2.0), garde les
// fermetures, bouchons, accidents, chantiers et obstacles (tools/trafic-convert.mjs) et écrit un petit JSON national,
// publié ensuite par l'Action sur la branche de données orpheline `trafic-data` (jamais sur main).
//
// Sûreté : https seulement, un seul domaine (tipi.bison-fute.gouv.fr, contrôlé à chaque redirection), taille limitée
// (20 Mo décodés), UTF-8 strict, lecteur XML maison (DOCTYPE refusé, rien d'évalué), JSON ≤ 1 Mo et ≤ 3 000 événements.
// Les fichiers par événement du même dossier ne sont jamais lus : seule la liste du dossier est comptée (complétude).
// Si le flux est illisible : rien n'est écrit, l'ancien JSON reste sur `trafic-data`, le journal le dit (avertissement,
// sortie 0 : une panne de la source n'est pas une erreur du dépôt). Aucune coordonnée dans le journal.
//
// Usage : node tools/trafic-update.mjs sortie.json              (télécharge)
//         node tools/trafic-update.mjs sortie.json fichier.xml  (lit un fichier local, pour essai)

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { collectXml, convertTraffic, listingStats, trafficLog } from './trafic-convert.mjs';

export const FEED_DIR = 'https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN/';
export const FEED_URL = `${FEED_DIR}content.xml`;
export const ALLOWED_HOSTS = Object.freeze(['tipi.bison-fute.gouv.fr']);
const MAX_ATTEMPTS = 3;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 20 * 1024 * 1024;     // 20 Mo au plus (compressé ou décodé)
const MAX_LISTING_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 60 * 1000;

export function checkUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error(`adresse refusée (pas https) : ${u.protocol}`);
  if (!ALLOWED_HOSTS.includes(u.hostname)) throw new Error(`domaine refusé : ${u.hostname}`);
  return u;
}

/** Lit un corps de réponse en octets, plafonné. */
async function readCapped(body, max) {
  const parts = [];
  let n = 0;
  for await (const chunk of body) {
    n += chunk.length;
    if (n > max) throw new Error('fichier trop gros');
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

/** GET https sur le seul domaine permis, redirections contrôlées. */
export async function fetchCapped(url, { max = MAX_BYTES, accept = 'application/xml,text/xml,*/*;q=0.5' } = {}) {
  let current = checkUrl(url).href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(current, { redirect: 'manual', headers: { Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`redirection ${res.status} sans adresse`);
      current = checkUrl(new URL(loc, current).href).href;
      process.stdout.write(`   ${res.status} → ${current}\n`);
      continue;
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const buf = await readCapped(res.body, max);
    return { buf, lastModified: res.headers.get('last-modified'), type: res.headers.get('content-type') ?? '', encoding: res.headers.get('content-encoding') ?? '' };
  }
  throw new Error('trop de redirections');
}

/** Octets → texte : gzip éventuel (fichier lui-même compressé), UTF-8 strict, BOM retirée. */
export function decodeBody(buf, max = MAX_BYTES) {
  let b = buf;
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b, { maxOutputLength: max });
  const text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, bytes: b.length };
}

/**
 * Lecture + conversion d'un texte XML. Ne lève jamais : { ok, result?, stats?, log }.
 */
export function convertText(text, { now, lastModified = null, bytesRead = null, listing = null } = {}) {
  let c;
  try { c = collectXml(text); } catch (err) {
    return { ok: false, log: `Flux illisible (${String(err?.message || err).slice(0, 200)}) : l'ancien JSON reste (branche trafic-data inchangée).` };
  }
  const result = convertTraffic(c.records, { now, stats: c.stats, lastModified });
  const ids = new Set(c.records.flatMap((r) => [r.tree.id, r.situation?.id]));
  const lst = typeof listing === 'function' ? listing(ids) : listing;
  const log = trafficLog(c.stats, result, { bytesRead, lastModified, listing: lst });
  if (result.problem) return { ok: false, stats: c.stats, result, log: `${log}\nCopie refusée : ${result.problem}. L'ancien JSON reste (branche trafic-data inchangée).` };
  if (!c.stats.records) return { ok: false, stats: c.stats, result, log: `${log}\nFlux sans aucun enregistrement : l'ancien JSON reste (branche trafic-data inchangée).` };
  return { ok: true, stats: c.stats, result, log };
}

function ghOutput(pairs) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  appendFileSync(f, Object.entries(pairs).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, ' ')}\n`).join(''));
}
function ghSummary(text) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, `\n\`\`\`\n${text.replace(/```/g, "'''")}\n\`\`\`\n`);
}

async function readListing() {
  try {
    const { buf, type } = await fetchCapped(FEED_DIR, { max: MAX_LISTING_BYTES, accept: 'text/html,*/*;q=0.5' });
    const html = decodeBody(buf, MAX_LISTING_BYTES).text;
    if (!/<a\s/i.test(html)) return { error: `pas de liste de fichiers (${type || 'type inconnu'})` };
    return (ids) => listingStats(html, ids);
  } catch (err) {
    return { error: String(err?.message || err).slice(0, 120) };
  }
}

async function main() {
  const now = Date.now();
  const out = process.argv[2];
  const local = process.argv[3];
  if (!out) throw new Error('usage : node tools/trafic-update.mjs sortie.json [fichier.xml]');
  console.log(`Trafic — copie du ${new Date(now).toISOString()} (UTC). Source : Bison Futé (DIR), Licence Ouverte Etalab 2.0. La signalisation fait foi.`);
  let res;
  if (local) {
    const { text, bytes } = decodeBody(readFileSync(local));
    res = convertText(text, { now, bytesRead: bytes });
  } else {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      console.log(`\n── essai ${attempt}/${MAX_ATTEMPTS} : ${FEED_URL}`);
      let got;
      try {
        got = await fetchCapped(FEED_URL);
        console.log(`   200 ${got.type} ${got.encoding ? `(${got.encoding}) ` : ''}${got.buf.length} o reçus`);
      } catch (err) {
        res = { ok: false, log: `Flux illisible (téléchargement : ${String(err?.message || err).slice(0, 200)}) : l'ancien JSON reste (branche trafic-data inchangée).` };
        console.log(`   échec : ${String(err?.message || err).slice(0, 200)}`);
        if (/domaine refusé|pas https/.test(err?.message ?? '')) break;
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 15000 * attempt));
        continue;
      }
      let decoded;
      try { decoded = decodeBody(got.buf); } catch (err) {
        res = { ok: false, log: `Flux illisible (décodage : ${String(err?.message || err).slice(0, 200)}) : l'ancien JSON reste (branche trafic-data inchangée).` };
        break;
      }
      const listing = await readListing();
      res = convertText(decoded.text, { now, lastModified: got.lastModified, bytesRead: decoded.bytes, listing });
      break; // XML lu ou mal formé : un nouvel essai ne changerait rien
    }
  }
  console.log(`\n${res.log}`);
  ghSummary(res.log);
  if (!res.ok) {
    console.log("::warning title=Trafic::Flux illisible ou copie refusée : l'ancien JSON reste (branche trafic-data inchangée).");
    ghOutput({ ok: 'false' });
    return;
  }
  writeFileSync(out, res.result.text);
  console.log(`\nJSON écrit : ${res.result.bytes} octets, ${res.result.json.count} événements.`);
  ghOutput({ ok: 'true', publication: res.result.json.publication ?? res.result.json.copied, count: res.result.json.count });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
