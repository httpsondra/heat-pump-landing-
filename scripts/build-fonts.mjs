/**
 * build-fonts.mjs
 * --------------------------------------------------------------------------
 * Vyrobí self-hostované WOFF2 podmnožiny Interu a JetBrains Mono.
 *
 * Výstup:
 *   fonts/inter-var-latin.woff2           – variabilní, osa wght 100–900
 *   fonts/jetbrains-mono-400-latin.woff2  – statický řez 400
 *
 * Spuštění:  npm install && npm run build:fonts
 *
 * PROČ TENHLE SKRIPT EXISTUJE
 * Binární font upravený ručně je neudržovatelný: za rok nikdo neví, z čeho
 * vznikl ani co v něm chybí. Tohle je celý postup zapsaný tak, aby šel
 * kdykoli zopakovat a dal stejný výsledek.
 *
 * ZDROJ JSOU KANONICKÉ FONTY Z google/fonts, ne to, co posílá CDN.
 * Ověřeno porovnáním obrysů: Inter instancovaný na opsz=14 a JetBrains Mono
 * na wght=400 mají znak po znaku stejné obrysy i šířky jako soubory, které
 * dosud chodily z fonts.gstatic.com. Otisk SHA-256 níž hlídá, že se pod
 * rukama nevymění verze.
 *
 * OPSZ SE MUSÍ PŘIPNOUT NA 14. Inter má ve zdroji dvě osy — opsz a wght.
 * CSS má `font-optical-sizing: auto` jako výchozí hodnotu, takže ponechaná
 * osa opsz by měnila kresbu podle velikosti písma a web by se sázel jinak
 * než dosud. Kontrola: při opsz=32 nesedí ani jeden ze 44 zkoušených obrysů,
 * při opsz=14 sedí všechny.
 * --------------------------------------------------------------------------
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'fonts');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'fonts');

/* ---- sada znaků ---------------------------------------------------------
 *
 * NEOŘEZÁVAT PODLE DNEŠNÍHO TEXTU STRÁNKY. Do Interu i do JetBrains Mono
 * teče text od návštěvníka: formulář sází Interem a `renderSummary()`
 * v js/form.js strká vypsané město do `.inquiry__chip`, což je monospace.
 * Úzká podmnožina „jen co je dnes v HTML" by u jednoho zákazníka jménem
 * Müller nebo z Ľubochne vypadla do náhradního písma uprostřed slova.
 *
 * Celá sada stojí proti té nejužší 420 B. Není o čem přemýšlet.
 */
const ASCII = range(0x20, 0x7e);
const LATIN1 = range(0xa0, 0xff);
const CZECH = 'ÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž';
const SLOVAK = 'ÄäĹĺĽľŔŕÔô';
const POLISH = 'ĄąĆćĘęŁłŃńŚśŹźŻż';
const PUNCTUATION = '‑–—“”„‚‘’…•€↓';

/*
 * Kombinující diakritika. Bez ní subsetter vyhodí jako nedosažitelné i
 * tabulky ccmp, mark a mkmk — a rozložený zápis (`e` + U+030C), který
 * posílají některé klávesnice, by se rozpadl na náhradní písmo. Google to
 * ve svých podmnožinách drží taky; stojí to 2,2 kB.
 */
const COMBINING = range(0x0300, 0x030c);

export const CHARSET = ASCII + LATIN1 + CZECH + SLOVAK + POLISH + PUNCTUATION + COMBINING;

/*
 * ŠIPKY A MATEMATICKÉ ZNAKY SEM NEPATŘÍ.
 *
 * `→ ← ↗ ≈ ≥ ◉` leží mimo oba unicode-range, které Google posílá, takže je
 * stránka dnes sází systémovým písmem. Kdyby se dostaly do podmnožiny,
 * začaly by se kreslit Interem a vzhled by se změnil. Tenhle seznam je tu
 * proto, aby to bylo vidět jako rozhodnutí, ne jako opomenutí — a test
 * v js/fonts.test.mjs hlídá, že v sadě nejsou.
 */
export const DELIBERATELY_EXCLUDED = '→←↗≈≥◉';

/* ---- zdroje -------------------------------------------------------------
 *
 * Otisky jsou z verzí Inter 4.001 (git-66647c0bb) a JetBrains Mono 2.211,
 * tedy přesně těch, které dosud servírovalo fonts.gstatic.com.
 */
const SOURCES = [
  {
    name: 'Inter',
    file: 'Inter[opsz,wght].ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf',
    sha256: '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031',
    out: 'inter-var-latin.woff2',
    // opsz připnuto, wght zůstává osou — jeden soubor obslouží 400, 600 i 700.
    variationAxes: { opsz: 14 },
  },
  {
    name: 'JetBrains Mono',
    file: 'JetBrainsMono[wght].ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf',
    sha256: '48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda',
    out: 'jetbrains-mono-400-latin.woff2',
    // Jediný řez, který se na webu sází. Připnutím vznikne statický font.
    variationAxes: { wght: 400 },
  },
];

/*
 * OpenType funkce, které si font nechá.
 *
 * Bez tohohle seznamu si harfbuzz nechá úplně všechno — a Inter veze osm
 * stylistických sad a přes tucet znakových variant. Jejich alternativní
 * glyfy se do podmnožiny protáhnou přes uzávěr GSUB a font naroste
 * z 34 kB na 73 kB, aniž by se jediný z nich kdy vykreslil: žádné CSS
 * na webu je nezapíná.
 *
 * Seznam je přesně ta sada, kterou má dnešní soubor z fonts.gstatic.com:
 *   GSUB  calt ccmp dnom frac locl numr pnum tnum
 *   GPOS  kern mark mkmk
 * Vypustit kteroukoli z nich by znamenalo změnu sazby — kern drží
 * mezery mezi písmeny, tnum tabulková čísla v .mono, mark a mkmk
 * navazují diakritiku u rozložených zápisů.
 */
const KEEP_FEATURES = [
  'calt',
  'ccmp',
  'dnom',
  'frac',
  'kern',
  'locl',
  'mark',
  'mkmk',
  'numr',
  'pnum',
  'tnum',
];

function range(from, to) {
  let out = '';
  for (let cp = from; cp <= to; cp += 1) out += String.fromCodePoint(cp);
  return out;
}

/** Stáhne zdroj (nebo sáhne do keše) a ověří otisk. */
async function source({ name, file, url, sha256 }) {
  const cached = path.join(CACHE_DIR, file);
  let bytes;

  if (existsSync(cached)) {
    bytes = await readFile(cached);
  } else {
    process.stdout.write(`  stahuji ${file} …\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: zdroj nedostupný (HTTP ${res.status})`);
    bytes = Buffer.from(await res.arrayBuffer());
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cached, bytes);
  }

  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== sha256) {
    throw new Error(
      `${name}: otisk nesouhlasí.\n  čekáno ${sha256}\n  dostal  ${got}\n` +
        'Zdrojový font se změnil. Nepřepisuj otisk naslepo — ověř, že nová verze ' +
        'sází stejně, jinak se web typograficky pohne.',
    );
  }
  return bytes;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let total = 0;

  for (const spec of SOURCES) {
    const bytes = await source(spec);
    const subset = await subsetFont(bytes, CHARSET, {
      targetFormat: 'woff2',
      variationAxes: spec.variationAxes,
      keepFeatures: KEEP_FEATURES,
      // Instrukce hintingu pryč — dnešní soubor z CDN je taky nemá
      // (chybí mu fpgm, prep i cvt) a prohlížeče na desktopu i mobilu
      // dnes kreslí bez nich. Nechat je by znamenalo bajty navíc za
      // něco, co se stejně nepoužije.
      noHinting: true,
    });
    await writeFile(path.join(OUT_DIR, spec.out), subset);
    total += subset.length;
    console.log(`  ${spec.out.padEnd(32)} ${String(subset.length).padStart(7)} B`);
  }

  console.log(`  ${'celkem'.padEnd(32)} ${String(total).padStart(7)} B`);
}

// Test si soubor importuje kvůli CHARSET a DELIBERATELY_EXCLUDED. Stavět
// při tom fonty (a sahat na síť) by nedávalo smysl, takže main() běží jen
// při skutečném spuštění skriptu.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
