// Coordonnées GPS saisies dans le champ départ ou arrivée (phase 8). Logique pure.
//
// Formats lus (latitude puis longitude, comme Google Maps, OpenStreetMap et la plupart des GPS) :
// - décimal : « 48.6921, 6.1844 », « 48,6921 6,1844 », « 48.6921;6.1844 », « -21.11, 55.53 » ;
// - degrés-minutes-secondes : « 48°41'31.6"N 6°11'03.8"E » (aussi ′ ″, ’ ”, et O pour Ouest) ;
// - degrés-minutes décimales : « 48°41.527'N 6°11.063'E » ;
// - lettre devant : « N 48°41'31.6" E 6°11'03.8" ».
// Hémisphère : N/S pour la latitude, E/O/W pour la longitude ; une lettre fixe aussi l'ordre si besoin.

/** Bornes de validité (WGS 84). */
const LAT_MAX = 90;
const LON_MAX = 180;

const DEC = '[-+]?\\d{1,3}(?:[.,]\\d+)?';

/**
 * Décimal : deux nombres. Avec la virgule décimale française, le séparateur doit être un espace ou un « ; »
 * (« 48,6921 6,1844 ») ; « 48,6921, 6,1844 » est aussi accepté.
 */
function parseDecimal(text) {
  const t = text.trim();
  const m = new RegExp(`^(${DEC})\\s*(?:[;\\s]|,\\s)\\s*(${DEC})$`).exec(t)
    ?? new RegExp(`^(${DEC})\\s*,\\s*(${DEC})$`).exec(t);
  if (!m) return null;
  const num = (s) => Number(s.replace(',', '.'));
  return { lat: num(m[1]), lon: num(m[2]) };
}

/** Un nombre de degrés (+ minutes + secondes), sans lettre. */
const ANGLE = new RegExp(
  '([-+]?\\d{1,3}(?:[.,]\\d+)?)\\s*(?:°|º|d|deg)?\\s*'
  + '(?:(\\d{1,2}(?:[.,]\\d+)?)\\s*(?:\'|′|’|m)\\s*)?'
  + '(?:(\\d{1,2}(?:[.,]\\d+)?)\\s*(?:"|″|”|\'\'|s)\\s*)?',
  'y',
);

/**
 * Suite de jetons : lettres d'hémisphère et angles. La lettre est devant les nombres si le texte commence par une
 * lettre (« N 48°41' E 6°11' »), derrière sinon (« 48°41'N 6°11'E »).
 */
function parseDms(text) {
  const t = text.trim().toUpperCase();
  const tokens = [];
  let pos = 0;
  while (pos < t.length) {
    const c = t[pos];
    if (/[\s,;]/.test(c)) { pos += 1; continue; }
    if (/[NSEOW]/.test(c)) { tokens.push({ hemi: c }); pos += 1; continue; }
    ANGLE.lastIndex = pos;
    const m = ANGLE.exec(t);
    if (!m || !m[0]) return null;
    pos = ANGLE.lastIndex;
    const num = (x) => (x ? Number(x.replace(',', '.')) : 0);
    const deg = num(m[1]);
    const min = num(m[2]);
    const sec = num(m[3]);
    if (min >= 60 || sec >= 60) return null;
    const value = Math.abs(deg) + min / 60 + sec / 3600;
    tokens.push({ value: m[1].startsWith('-') ? -value : value });
  }
  const prefix = tokens[0] && 'hemi' in tokens[0];
  const parts = [];
  let pending = '';
  for (const tk of tokens) {
    if (!('hemi' in tk)) {
      parts.push({ value: tk.value, hemi: prefix ? pending : '' });
      pending = '';
    } else if (prefix) {
      if (pending) return null; // deux lettres de suite
      pending = tk.hemi;
    } else {
      const last = parts[parts.length - 1];
      if (!last || last.hemi) return null;
      last.hemi = tk.hemi;
    }
  }
  if (pending) return null;
  if (parts.length !== 2) return null;
  const isLat = (h) => h === 'N' || h === 'S';
  const isLon = (h) => h === 'E' || h === 'O' || h === 'W';
  let [a, b] = parts;
  if (isLon(a.hemi) || isLat(b.hemi)) [a, b] = [b, a]; // « 6°11'E 48°41'N »
  if ((a.hemi && !isLat(a.hemi)) || (b.hemi && !isLon(b.hemi))) return null;
  if ((a.hemi && a.value < 0) || (b.hemi && b.value < 0)) return null; // signe et lettre ensemble : ambigu
  const lat = a.hemi === 'S' ? -a.value : a.value;
  const lon = b.hemi === 'O' || b.hemi === 'W' ? -b.value : b.value;
  return { lat, lon };
}

/**
 * Lit des coordonnées GPS saisies. Ne lève jamais.
 * @param {string} text
 * @returns {{ lat:number, lon:number }|null} null si ce n'est pas un couple de coordonnées valide
 */
export function parseCoordinates(text) {
  if (typeof text !== 'string' || text.length > 100) return null;
  const t = text.trim();
  if (!t) return null;
  const r = /[°º'′’"″”]|[NSEOW]\s*$|^[NSEOW]\s*\d/i.test(t) ? parseDms(t) : parseDecimal(t);
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return null;
  if (Math.abs(r.lat) > LAT_MAX || Math.abs(r.lon) > LON_MAX) return null;
  return { lat: r.lat, lon: r.lon };
}

/** Libellé d'un point donné par ses coordonnées : « 48,69210, 6,18440 » (5 décimales ≈ 1 m). */
export function coordsLabel({ lat, lon }) {
  const f = (x) => x.toFixed(5).replace('.', ',');
  return `${f(lat)}, ${f(lon)}`;
}
