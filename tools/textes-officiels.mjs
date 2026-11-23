// Lecture de textes officiels pour l'Action « Textes officiels » (.github/workflows/textes-officiels.yml).
// Beaucoup de sites officiels sont bloqués depuis le conteneur de développement : l'Action les lit et écrit dans son
// journal des extraits autour des mots-clés de tools/textes-officiels.json. Aucune donnée n'est enregistrée : les
// extraits sont relus par un humain (ou Claude) avant d'être cités dans le code, avec la date de lecture.
// Méthode écrite pour chaque document : « html », « pdf-texte » (pdftotext) ou « ocr » (tesseract) — un chiffre lu par
// OCR n'est jamais codé sans recoupement (seconde lecture indépendante ou contrôle de cohérence).
//
// Entrée « tiles » (phase 7d) : tuiles réelles demandées avec l'en-tête Origin du site publié ; le journal donne statut
// HTTP, type de contenu, taille et en-tête CORS access-control-allow-origin (MapLibre charge les tuiles raster par fetch).
// Entrée « headers » (phase 4) : API JSON demandée avec l'en-tête Origin du site publié ; le journal donne tous les
// en-têtes de réponse (CORS, quotas) et le début du corps.
// Champ « run » du fichier : liste des entrées lues (toutes si absent).
//
// Usage : node tools/textes-officiels.mjs [fichier.json] [id…]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_DOCS = 12;        // documents lus au plus par entrée (liens suivis compris)
const MAX_EXTRACTS = 8;     // extraits imprimés au plus par mot-clé et par document
const SPAN = 1200;          // caractères autour d'un mot-clé
const WORK = 'textes-tmp';

function clean(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ({ euro: '€', eacute: 'é', egrave: 'è', agrave: 'à', ouml: 'ö', uuml: 'ü',
      auml: 'ä', szlig: 'ß', sect: '§', deg: '°', ccedil: 'ç', ecirc: 'ê' }[n.toLowerCase()] ?? m))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

function rtfText(rtf) {
  return rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => Buffer.from([parseInt(h, 16)]).toString('latin1'))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\(par|line|row|cell)\b ?/g, '\n')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

function pdfText(file, langs) {
  let text = '';
  try { text = execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 1 << 28 }).toString(); } catch { /* */ }
  if (text.replace(/\s/g, '').length > 200) return { method: 'pdf-texte', text };
  // PDF scanné : reconnaissance de texte page par page.
  try {
    execFileSync('pdftoppm', ['-r', '300', '-gray', '-l', '20', file, `${WORK}/page`]);
    const pages = execFileSync('sh', ['-c', `ls ${WORK}/page*.pgm 2>/dev/null || true`]).toString().split('\n').filter(Boolean);
    text = pages.map((p) => {
      try { return execFileSync('tesseract', [p, '-', '-l', langs], { maxBuffer: 1 << 26 }).toString(); } catch { return ''; }
    }).join('\n');
    execFileSync('sh', ['-c', `rm -f ${WORK}/page*.pgm`]);
  } catch { /* */ }
  return { method: 'ocr', text };
}

// curl (certificats du système, IPv4 d'abord, en-têtes de navigateur) : plusieurs sites refusent le client de Node
// (certificat intermédiaire manquant, IPv6 sans réponse, page « navigateur obsolète »).
async function fetchDoc(url) {
  const out = `${WORK}/body`;
  try {
    const meta = execFileSync('curl', [
      '-sS', '-L', '-4', '--compressed', '--max-time', '90', '--retry', '2', '-A', UA,
      '-H', 'Accept: text/html,application/xhtml+xml,application/pdf,*/*;q=0.8', '-H', 'Accept-Language: fr,de;q=0.9,it;q=0.8,en;q=0.7',
      '-o', out, '-w', '%{http_code} %{content_type} %{url_effective}', url,
    ], { maxBuffer: 1 << 20 }).toString().trim().split(' ');
    const [code, type = '', finalUrl = url] = meta;
    const { readFileSync } = await import('node:fs');
    return { status: Number(code), type, buf: readFileSync(out), finalUrl };
  } catch (err) {
    return { status: 0, error: String(err?.stderr || err?.message || err).trim().slice(0, 200) };
  }
}

function extracts(text, keywords) {
  const out = [];
  const flat = text;
  for (const kw of keywords) {
    const re = new RegExp(kw, 'gi');
    let m; let n = 0; let last = -Infinity;
    while ((m = re.exec(flat)) && n < MAX_EXTRACTS) {
      if (m.index - last < SPAN) continue;
      last = m.index; n += 1;
      out.push(`  ── « ${kw} » (position ${m.index}) ──\n${flat.slice(Math.max(0, m.index - SPAN / 2), m.index + SPAN)}`);
    }
    if (!n) out.push(`  ── « ${kw} » : absent`);
  }
  return out;
}

const ORIGIN = 'https://timgo211.github.io';

/** Case Web Mercator (x, y) au zoom z du point [lon, lat]. */
function tileOf(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y, n };
}

/** URL d'une tuile : {z} {x} {y} {-y} (TMS) et {bbox-epsg-3857} (WMS), comme MapLibre. */
function tileUrl(template, lon, lat, z) {
  const { x, y, n } = tileOf(lon, lat, z);
  const size = 40075016.68557849 / n;
  const minx = -20037508.342789244 + x * size;
  const maxy = 20037508.342789244 - y * size;
  const bbox = [minx, maxy - size, minx + size, maxy].map((v) => v.toFixed(2)).join(',');
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{-y}', n - 1 - y)
    .replace('{bbox-epsg-3857}', bbox);
}

function checkTile(t) {
  const url = tileUrl(t.url, t.lon, t.lat, t.z ?? 17);
  try {
    const out = execFileSync('curl', [
      '-sS', '-L', '-4', '--max-time', '60', '-A', UA, '-H', `Origin: ${ORIGIN}`, '-H', `Referer: ${ORIGIN}/Gabarit/`,
      '-D', '-', '-o', `${WORK}/tile`, '-w', '\n%{http_code} %{content_type} %{size_download}', url,
    ], { maxBuffer: 1 << 22 }).toString();
    const lines = out.trim().split('\n');
    const [code, type, size] = lines.pop().split(' ');
    const acao = lines.filter((l) => /^access-control-allow-origin:/i.test(l)).map((l) => l.split(':').slice(1).join(':').trim());
    const ok = code === '200' && /^image\//.test(type) && acao.some((v) => v === '*' || v === ORIGIN);
    console.log(`\n── tuile ${t.label} : ${url}\n   HTTP ${code}, ${type}, ${size} o, access-control-allow-origin : ${acao.join(' | ') || 'absent'} → ${ok ? 'UTILISABLE' : 'NON UTILISABLE'}`);
  } catch (err) {
    console.log(`\n── tuile ${t.label} : ${url}\n   échec : ${String(err?.stderr || err?.message || err).trim().slice(0, 200)} → NON UTILISABLE`);
  }
}

// Entrée « headers » (phase 4) : API JSON appelée par fetch depuis le site publié. GET simple (aucun en-tête ajouté
// par la page, donc pas de pré-vol) avec l'en-tête Origin du site ; le journal donne statut, type, taille, tous les
// en-têtes de réponse (CORS, quotas X-RateLimit-*) et le début du corps.
function checkHeaders(h) {
  try {
    const out = execFileSync('curl', [
      '-sS', '-L', '-4', '--compressed', '--max-time', '90', '-A', UA, '-H', `Origin: ${ORIGIN}`,
      '-H', `Referer: ${ORIGIN}/Gabarit/`, '-D', '-', '-o', `${WORK}/headers-body`,
      '-w', '\n%{http_code} %{content_type} %{size_download}', h.url,
    ], { maxBuffer: 1 << 22 }).toString();
    const lines = out.trim().split('\n');
    const [code, type, size] = lines.pop().split(' ');
    const acao = lines.filter((l) => /^access-control-allow-origin:/i.test(l)).map((l) => l.split(':').slice(1).join(':').trim());
    const ok = code === '200' && acao.some((v) => v === '*' || v === ORIGIN);
    console.log(`\n── en-têtes ${h.label} : ${h.url}\n   HTTP ${code}, ${type}, ${size} o, access-control-allow-origin : ${acao.join(' | ') || 'absent'} → ${ok ? 'CORS OK' : 'CORS NON'}`);
    for (const l of lines) if (l.trim()) console.log(`   | ${l.trim()}`);
    const body = execFileSync('head', ['-c', String(h.head ?? 3000), `${WORK}/headers-body`]).toString();
    console.log(`   corps : ${body}`);
  } catch (err) {
    console.log(`\n── en-têtes ${h.label} : ${h.url}\n   échec : ${String(err?.stderr || err?.message || err).trim().slice(0, 200)} → CORS NON`);
  }
}

async function readEntry(entry) {
  console.log(`\n████ ${entry.id} — ${entry.title}`);
  for (const t of entry.tiles ?? []) checkTile(t);
  for (const h of entry.headers ?? []) checkHeaders(h);
  const queue = [...(entry.urls ?? [])];
  const seen = new Set();
  let docs = 0;
  while (queue.length && docs < MAX_DOCS) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    docs += 1;
    const r = await fetchDoc(url);
    console.log(`\n── ${url} : HTTP ${r.status}${r.error ? ` (${r.error})` : ''} ${r.type || ''} ${r.buf ? `${r.buf.length} o` : ''}`);
    if (r.status !== 200 || !r.buf) continue;
    const isPdf = /pdf/i.test(r.type) || r.buf.subarray(0, 5).toString() === '%PDF-';
    const isRtf = /rtf/i.test(r.type) || r.buf.subarray(0, 5).toString() === '{\\rtf';
    let method; let text;
    if (isPdf) {
      await writeFile(`${WORK}/doc.pdf`, r.buf);
      ({ method, text } = pdfText(`${WORK}/doc.pdf`, entry.ocr || 'fra'));
    } else if (isRtf) {
      method = 'rtf'; text = rtfText(r.buf.toString('latin1'));
    } else {
      method = 'html';
      const html = r.buf.toString('utf8');
      text = clean(html);
      if (entry.follow) {
        const re = new RegExp(entry.follow, 'i');
        for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
          let link;
          try { link = new URL(m[1].replace(/&amp;/g, '&'), r.finalUrl || url).href; } catch { continue; }
          if (re.test(link) && !seen.has(link) && !queue.includes(link)) {
            console.log(`   lien suivi : ${link}`);
            queue.push(link);
          }
        }
      }
    }
    console.log(`   méthode : ${method}, ${text.length} caractères`);
    if (entry.head) console.log(`   début : ${text.slice(0, entry.head).replace(/\s+/g, ' ')}`);
    for (const e of extracts(text, entry.keywords)) console.log(e);
  }
}

const [file = 'tools/textes-officiels.json', ...only] = process.argv.slice(2);
const list = JSON.parse(await readFile(file, 'utf8'));
await mkdir(WORK, { recursive: true });
console.log(`Lecture du ${new Date().toISOString()} (UTC)`);
for (const entry of list.entries) {
  if (only.length ? !only.includes(entry.id) : Array.isArray(list.run) && !list.run.includes(entry.id)) continue;
  await readEntry(entry);
}
