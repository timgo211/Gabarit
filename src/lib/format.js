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
