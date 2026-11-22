// Lever et coucher du soleil (phase 2c, mode nuit automatique). Logique pure, sans dépendance.
// Source : NOAA Global Monitoring Laboratory, « General Solar Position Calculations »
// (https://gml.noaa.gov/grad/solcalc/solareqns.PDF) : équation du temps et déclinaison en série de Fourier, angle
// horaire du lever / coucher pour un zénith de 90,833° (réfraction et rayon apparent du soleil). Précision de
// l'ordre de la minute aux latitudes de l'Europe.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const ZENITH = 90.833;

function dayOfYear(y, m, d) {
  return Math.round((Date.UTC(y, m, d) - Date.UTC(y, 0, 1)) / DAY_MS) + 1;
}

/**
 * Lever et coucher du jour solaire qui contient `date` à la longitude donnée.
 * @param {Date|number} date
 * @param {number} lat degrés (nord positif)
 * @param {number} lon degrés (est positif)
 * @returns {{ sunrise:number|null, sunset:number|null, polar:'day'|'night'|null }} instants (ms depuis 1970)
 */
export function sunTimes(date, lat, lon) {
  const t = typeof date === 'number' ? date : date.getTime();
  // Jour solaire local : décalage de la longitude (15° par heure), pour que lever et coucher tombent le même jour.
  const local = new Date(t + (lon / 15) * 3600000);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const g = ((2 * Math.PI) / (leap ? 366 : 365)) * (dayOfYear(y, mo, d) - 1);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const phi = lat * RAD;
  const x = Math.cos(ZENITH * RAD) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
  if (x > 1) return { sunrise: null, sunset: null, polar: 'night' };
  if (x < -1) return { sunrise: null, sunset: null, polar: 'day' };
  const ha = Math.acos(x) / RAD;
  const midnight = Date.UTC(y, mo, d);
  return {
    sunrise: midnight + (720 - 4 * (lon + ha) - eqtime) * 60000,
    sunset: midnight + (720 - 4 * (lon - ha) - eqtime) * 60000,
    polar: null,
  };
}

/** Fait-il nuit (soleil couché) à cet instant et à cette position [lon, lat] ? null si la position est inconnue. */
export function isNight(date, lonlat) {
  if (!Array.isArray(lonlat) || !lonlat.every(Number.isFinite)) return null;
  const [lon, lat] = lonlat;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const t = typeof date === 'number' ? date : date.getTime();
  const s = sunTimes(t, lat, lon);
  if (s.polar) return s.polar === 'night';
  return t < s.sunrise || t >= s.sunset;
}
