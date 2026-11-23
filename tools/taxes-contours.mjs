// Remplace les contours de data/taxes-pl.json (phase 5h ter) par ceux de data/contours-ign.json (Action « Contours
// IGN », Admin Express COG récent). À relancer seulement avec le test de non-régression tests/taxes-contours.test.js :
// si un résultat de la 5h ter change, les nouveaux contours ne sont pas gardés.
// Usage : node tools/taxes-contours.mjs [contours] [taxes]
import { readFile, writeFile } from 'node:fs/promises';

const [cFile = 'data/contours-ign.json', tFile = 'data/taxes-pl.json'] = process.argv.slice(2);
const c = JSON.parse(await readFile(cFile, 'utf8'));
const before = await readFile(tFile, 'utf8');
const t = JSON.parse(before);
const year = c.year ?? 'dernière édition';
const lic = `IGN Admin Express COG ${year} (couche ${c.layer}, WFS de la Géoplateforme, Licence Ouverte Etalab 2.0)`;
const set = (zone, rings, text) => {
  zone.rings = rings;
  zone.source = text;
  zone.read = c.read;
  zone.check = 'limites exactes à vérifier (contours simplifiés)';
};
const tax = (id) => t.taxes.find((x) => x.id === id);
set(tax('r-pass').area, c.alsace, `Contours du Bas-Rhin et du Haut-Rhin : ${lic}, simplifiés à ${c.tolerance.departement} m`);
set(tax('r-pass').exclude, c.eurometropole, `Eurométropole de Strasbourg (EPCI n° 246700488) : contour de l'EPCI, ${lic}, simplifié à ${c.tolerance.epci} m`);
set(tax('ecpl').area, c.grandEst, `Contour de la région Grand Est : ${lic}, simplifié à ${c.tolerance.region} m ; Bas-Rhin et Haut-Rhin exclus (routes de la Collectivité européenne d'Alsace)`);
set(tax('ecpl').exclude, c.alsace, `Bas-Rhin et Haut-Rhin (même contour que le R-Pass) : ${lic}, simplifiés à ${c.tolerance.departement} m`);
set(tax('ecpl').roadAreas.N52, c.meurtheEtMoselle, `Contour de la Meurthe-et-Moselle : ${lic}, simplifié à ${c.tolerance.departement} m`);
// Mise en forme du fichier d'origine (anneaux sur une ligne).
const text = `${JSON.stringify(t, null, 2).replace(/\[\s+(-?\d+(?:\.\d+)?),\s+(-?\d+(?:\.\d+)?)\s+\]/g, '[$1,$2]')}\n`;
await writeFile(tFile, text);
console.log(`${tFile} : ${Buffer.byteLength(before)} → ${Buffer.byteLength(text)} octets`);
