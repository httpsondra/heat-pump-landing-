import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHARSET, DELIBERATELY_EXCLUDED } from '../scripts/build-fonts.mjs';

/**
 * POJISTKY KOLEM SELF-HOSTOVANÝCH FONTŮ.
 *
 * Většina pravidel níž nevypadá jako pravidlo, ale jako zbytečná pedanterie —
 * proto tu jsou. Každé z nich je zapsaný výsledek měření, ne názor:
 *
 *   • rozsah `font-weight: 100 900` by otevřel osu a mezilehlé řezy by se
 *     sázely doslova — v styles.css dnes žádný není, takže by se to
 *     neprojevilo hned, ale u prvního přidaného by se vzhled tiše rozešel
 *     s tím, jak web vypadal s Googlem,
 *   • sloučení latin a latin-ext do jedné deklarace bez unicode-range
 *     posunulo 376 rozměrů a zkrátilo stránku na desktopu o 24 px,
 *   • přednačtení JetBrains Mono by soupeřilo o pásmo s hero posterem,
 *     který je na mobilu LCP prvek.
 *
 * Kdo některé z toho příště „uklidí", má tady napsané, proč to nedělat.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

/**
 * Stránka bez komentářů.
 *
 * Komentáře u deklarací vysvětlují, co se tam NESMÍ napsat, a citují to
 * doslova — takže hledání zakázaného zápisu v surovém souboru najde samo
 * sebe. Kontroluje se to, co prohlížeč opravdu přečte.
 */
const markup = html.replace(/<!--[\s\S]*?-->/g, '');

/** Bloky @font-face z <head> stránky. */
function faces() {
  return [...markup.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
    family: (body.match(/font-family:\s*'([^']+)'/) || [])[1],
    weight: (body.match(/font-weight:\s*([^;]+);/) || [])[1]?.trim(),
    style: (body.match(/font-style:\s*([^;]+);/) || [])[1]?.trim(),
    display: (body.match(/font-display:\s*([^;]+);/) || [])[1]?.trim(),
    src: (body.match(/src:\s*url\('([^']+)'\)/) || [])[1],
    range: (body.match(/unicode-range:\s*([^;]+);/) || [])[1]?.trim(),
  }));
}

test('na Google Fonts nevede ani jeden odkaz', () => {
  assert.ok(!markup.includes('fonts.googleapis.com'), 'index.html odkazuje na fonts.googleapis.com');
  assert.ok(!markup.includes('fonts.gstatic.com'), 'index.html odkazuje na fonts.gstatic.com');

  const csp = vercel.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === 'Content-Security-Policy').value;
  assert.ok(!csp.includes('fonts.googleapis.com'), 'CSP stále povoluje fonts.googleapis.com');
  assert.ok(!csp.includes('fonts.gstatic.com'), 'CSP stále povoluje fonts.gstatic.com');
  assert.match(csp, /style-src 'self' 'unsafe-inline';/);
  assert.match(csp, /font-src 'self';/);
});

test('přednačítá se jedině Inter, a právě jednou', () => {
  const preloads = [...markup.matchAll(/<link[^>]*rel="preload"[^>]*>/g)].map(([tag]) => tag);
  const fontPreloads = preloads.filter((tag) => tag.includes('as="font"'));

  assert.equal(fontPreloads.length, 1, 'přednačtených fontů má být přesně jeden');
  assert.match(fontPreloads[0], /href="\/fonts\/inter-var-latin\.woff2"/);
  assert.match(fontPreloads[0], /type="font\/woff2"/);
  // Bez crossorigin si prohlížeč přednačtený font nezapočítá a stáhne ho podruhé.
  assert.match(fontPreloads[0], /crossorigin/);

  assert.ok(
    !fontPreloads.some((tag) => /jetbrains/i.test(tag)),
    'JetBrains Mono se přednačítat nemá',
  );
});

test('Inter má jen řezy 400, 600 a 700, každý ve dvou rozsazích', () => {
  const inter = faces().filter((f) => f.family === 'Inter');
  assert.equal(inter.length, 6);
  assert.deepEqual(
    inter.map((f) => f.weight).sort(),
    ['400', '400', '600', '600', '700', '700'],
  );
  assert.ok(inter.every((f) => f.style === 'normal'), 'kurzíva na webu není');
  assert.ok(inter.every((f) => f.display === 'swap'));
  assert.ok(inter.every((f) => f.src === '/fonts/inter-var-latin.woff2'));
});

test('JetBrains Mono má jen řez 400, taky ve dvou rozsazích', () => {
  const mono = faces().filter((f) => f.family === 'JetBrains Mono');
  assert.equal(mono.length, 2);
  assert.deepEqual(mono.map((f) => f.weight), ['400', '400']);
  assert.ok(mono.every((f) => f.src === '/fonts/jetbrains-mono-400-latin.woff2'));
});

test('žádný řez není zapsaný jako rozsah osy', () => {
  // S otevřenou osou by se mezilehlý řez sázel doslova. Dnes by to nebylo
  // vidět — v styles.css žádný není — a přesně proto to hlídá test, ne oko.
  assert.ok(
    !/font-weight:\s*\d+\s+\d+/.test(markup),
    'font-weight s rozsahem by změnil sazbu pětistovky',
  );
});

test('dělení latin / latin-ext zůstává zachované', () => {
  const all = faces();
  assert.equal(all.length, 8, 'osm bloků: Inter 3 řezy × 2 rozsahy, mono 1 × 2');
  assert.ok(all.every((f) => f.range), 'každý blok musí mít unicode-range');

  const latin = all.filter((f) => f.range.startsWith('U+0000-00FF'));
  const ext = all.filter((f) => f.range.startsWith('U+0100-02BA'));
  assert.equal(latin.length, 4);
  assert.equal(ext.length, 4);

  // Přesně ty rozsahy, které posílal Google — jiné by přesunuly hranici běhů.
  assert.ok(latin.every((f) => f.range.includes('U+2000-206F') && f.range.includes('U+FFFD')));
  assert.ok(ext.every((f) => f.range.includes('U+1E00-1E9F') && f.range.includes('U+A720-A7FF')));
});

test('soubory fontů v repozitáři existují a nejsou prázdné', () => {
  for (const file of ['inter-var-latin.woff2', 'jetbrains-mono-400-latin.woff2']) {
    const stat = statSync(path.join(ROOT, 'fonts', file));
    assert.ok(stat.size > 10_000, `${file} vypadá useknutě (${stat.size} B)`);
  }
  // Obě rodiny jsou pod SIL OFL 1.1 — licence musí ležet u souborů.
  for (const file of ['OFL-Inter.txt', 'OFL-JetBrainsMono.txt']) {
    const text = readFileSync(path.join(ROOT, 'fonts', file), 'utf8');
    assert.match(text, /SIL OPEN FONT LICENSE/i);
  }
});

test('fonty se z Vercelu servírují s trvalou cache', () => {
  const rule = vercel.headers.find((h) => h.source === '/fonts/(.*)');
  assert.ok(rule, 'chybí pravidlo pro /fonts/(.*)');
  const cache = rule.headers.find((h) => h.key === 'Cache-Control');
  assert.equal(cache.value, 'public, max-age=31536000, immutable');
});

test('sada znaků pokrývá češtinu i to, co může přijít z formuláře', () => {
  for (const ch of 'ÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž') {
    assert.ok(CHARSET.includes(ch), `v sadě chybí ${ch}`);
  }
  for (const ch of 'ĽľŕôĄąĘęŁłŚśŻż') {
    assert.ok(CHARSET.includes(ch), `slovenské/polské ${ch} má být v sadě kvůli formuláři`);
  }
  for (const ch of 'äöüßçñå') {
    assert.ok(CHARSET.includes(ch), `Latin-1 ${ch} má být v sadě kvůli formuláři`);
  }
  // Rozložený zápis (`e` + háček) posílají některé klávesnice. Kombinující
  // znaky jsou zapsané ESCAPE SEKVENCEMI schválně — v diffu nejsou vidět
  // a přehlédly by se, stejně to dělá api/_crm.mjs.
  assert.ok(CHARSET.includes('̌'), 'kombinující háček musí v sadě zůstat');
  assert.ok(CHARSET.includes('́'), 'kombinující čárka musí v sadě zůstat');
});

test('symboly, které dnes sází systémové písmo, do sady nepatří', () => {
  // Kdyby se dostaly do fontu, začal by je kreslit Inter a vzhled by se změnil.
  for (const ch of DELIBERATELY_EXCLUDED) {
    assert.ok(!CHARSET.includes(ch), `${ch} by se nově vykreslil Interem`);
  }
  assert.ok(DELIBERATELY_EXCLUDED.includes('→'), 'šipka z karet služeb tam patří');
});
