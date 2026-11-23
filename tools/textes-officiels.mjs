// Lecture de textes officiels pour l'Action « Textes officiels » (.github/workflows/textes-officiels.yml).
// Beaucoup de sites officiels sont bloqués depuis le conteneur de développement : l'Action les lit et écrit dans son
// journal des extraits autour des mots-clés de tools/textes-officiels.json. Aucune donnée n'est enregistrée : les
// extraits sont relus par un humain (ou Claude) avant d'être cités dans le code, avec la date de lecture.
// Méthode écrite pour chaque document : « html », « pdf-texte » (pdftotext) ou « ocr » (tesseract) — un chiffre lu par
// OCR n'est jamais codé sans recoupement (seconde lecture indépendante ou contrôle de cohérence).
//
// Usage : node tools/textes-officiels.mjs [fichier.json] [id…]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) Gabarit (lecture de textes officiels)';
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

async function fetchDoc(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr,de,it,en' }, redirect: 'follow',
      signal: AbortSignal.timeout(60_000) });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type') || '', buf, finalUrl: res.url };
  } catch (err) {
    return { status: 0, error: String(err?.cause?.code || err?.message || err) };
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

async function readEntry(entry) {
  console.log(`\n████ ${entry.id} — ${entry.title}`);
  const queue = [...entry.urls];
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
  if (only.length && !only.includes(entry.id)) continue;
  await readEntry(entry);
}
