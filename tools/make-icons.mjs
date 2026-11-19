// Génère icons/icon-192.png et icons/icon-512.png (sans dépendance) d'après le même dessin que icons/icon.svg.
// Usage : node tools/make-icons.mjs  (à relancer seulement si le dessin change)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [15, 23, 32];
const FG = [255, 176, 0];
const WIN = [15, 23, 32];
// Formes sur une grille 512 × 512 (identiques au SVG).
const rects = [
  { x: 96, y: 176, w: 224, h: 160, c: FG },   // remorque
  { x: 328, y: 224, w: 88, h: 112, c: FG },   // cabine
  { x: 344, y: 240, w: 56, h: 40, c: WIN },   // vitre
];
const circles = [
  { cx: 152, cy: 360, r: 28 }, { cx: 264, cy: 360, r: 28 }, { cx: 384, cy: 360, r: 28 },
];

function colorAt(x, y) {
  let c = BG;
  for (const r of rects) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) c = r.c;
  for (const k of circles) {
    const d = Math.hypot(x - k.cx, y - k.cy);
    if (d <= k.r) c = d <= k.r - 12 ? BG : FG;
  }
  return c;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const S = 4; // sur-échantillonnage pour lisser les bords
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy += 1) for (let sx = 0; sx < S; sx += 1) {
        const c = colorAt(((x + (sx + 0.5) / S) * 512) / size, ((y + (sy + 0.5) / S) * 512) / size);
        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i += 1) raw[o + i] = Math.round(acc[i] / (S * S));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
}
console.log('Icônes générées.');
