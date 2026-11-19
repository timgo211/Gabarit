// Formatage français des distances, durées et heures. Logique pure (sans Intl, pour des tests stables).

function frDecimal(n, digits) {
  return n.toFixed(digits).replace('.', ',');
}

/** 850 → « 850 m » ; 12345 → « 12,3 km » ; 123456 → « 123 km ». */
export function formatDistance(meters) {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  if (km < 100) return `${frDecimal(km, 1)} km`;
  return `${Math.round(km)} km`;
}

/** Distance du guidage : arrondie à 10 m sous 1 km (affichage moins agité), sinon comme formatDistance. */
export function formatNavDistance(meters) {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 995) return `${Math.round(meters / 10) * 10} m`;
  return formatDistance(Math.max(1000, meters));
}

/** Vitesse « 87 km/h » depuis des km/h. */
export function formatSpeed(kmh) {
  if (typeof kmh !== 'number' || !Number.isFinite(kmh) || kmh < 0) return '—';
  return `${Math.round(kmh)} km/h`;
}

/** 2700 → « 45 min » ; 7500 → « 2 h 05 ». */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** Heure d'arrivée locale « 14:32 », suffixée « (+1 j) » si l'arrivée tombe un autre jour. */
export function formatArrival(now, seconds) {
  if (!(now instanceof Date) || typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  const arr = new Date(now.getTime() + seconds * 1000);
  const hh = String(arr.getHours()).padStart(2, '0');
  const mm = String(arr.getMinutes()).padStart(2, '0');
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const arrDay = new Date(arr.getFullYear(), arr.getMonth(), arr.getDate()).getTime();
  const days = Math.round((arrDay - startDay) / 86400000);
  return days > 0 ? `${hh}:${mm} (+${days} j)` : `${hh}:${mm}`;
}

/** Litres « 52,4 L ». */
export function formatLiters(l) {
  if (typeof l !== 'number' || !Number.isFinite(l)) return '—';
  return `${frDecimal(l, 1)} L`;
}

const MINUS = '\u2212'; // signe moins typographique « − »

/** Écart de durée signé, à la minute : 360 → « +6 min » ; −3900 → « −1 h 05 » ; 20 → « ±0 min ». */
export function formatDurationDelta(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  const min = Math.round(Math.abs(seconds) / 60);
  if (min === 0) return '±0 min';
  return `${seconds < 0 ? MINUS : '+'}${formatDuration(min * 60)}`;
}

/** Écart de distance signé : −12345 → « −12 km » ; 2400 → « +2,4 km » ; 430 → « +430 m » ; 20 → « ±0 km ». */
export function formatDistanceDelta(meters) {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return '—';
  const abs = Math.abs(meters);
  const sign = meters < 0 ? MINUS : '+';
  if (abs < 50) return '±0 km';
  if (abs < 995) return `${sign}${Math.round(abs / 10) * 10} m`;
  const km = abs / 1000;
  if (km < 9.95) return `${sign}${frDecimal(km, 1)} km`;
  return `${sign}${Math.round(km)} km`;
}

/** Montant en euros : « 92 € » ; sous 10 €, au dixième : « 2,7 € ». */
export function formatEuros(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return '—';
  return amount < 9.95 ? `${frDecimal(amount, 1)} €` : `${Math.round(amount)} €`;
}

/** Prix au litre « 1,859 » (2 décimales minimum, 3 au plus) ; '' si absent. */
export function formatPricePerLiter(price) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return '';
  const s = frDecimal(price, 3);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}
