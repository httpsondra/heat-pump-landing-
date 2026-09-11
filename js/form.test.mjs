/* =========================================================================
   Prohlížečová půlka mostu do CRM
   -------------------------------------------------------------------------
   `js/form.js` je jeden IIFE pro prohlížeč: sahá na `document`, `window`
   a `localStorage` hned při načtení, takže se v Node nedá spustit ani
   importovat. Kdyby se kvůli testu rozřezal na moduly, byla by to přestavba
   celého formuláře — a ta se kvůli jednomu mostu dělat nemá.

   ČTE SE PROTO ZDROJ. Je to slabší nástroj než skutečné vykonání a je
   potřeba o tom vědět: hlídá se ZAPOJENÍ, ne chování za běhu. Přesto to
   chytí právě ty chyby, které tady hrozí — že se snímek přestane přikládat,
   že se ho někdo pokusí v tichosti zakládat znovu, že se konverze začne
   hlásit dřív než po úspěšném odeslání, nebo že se do snímku přimíchá
   osobní údaj.

   Chování serverové půlky (whitelist, ořezy, klíč idempotence) se testuje
   doopravdy v `api/_crm.test.mjs`.
   ========================================================================= */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FORM = readFileSync(new URL('./form.js', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** Tělo funkce podle jejího jména — ať se hledá v tom, co se opravdu týká. */
function body(source, name) {
  const start = source.indexOf('function ' + name);
  assert.ok(start > -1, 'funkce ' + name + ' ve zdroji není');
  const from = source.indexOf('{', start);
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  throw new Error('konec funkce ' + name + ' se nenašel');
}

describe('snímek prvního dotyku se k poptávce PŘIKLÁDÁ', () => {
  const reader = body(FORM, 'firstTouchSnapshot');

  it('poptávka veze surový identifikátor odeslání i snímek', () => {
    const send = body(FORM, 'sendConfirmation');

    assert.match(send, /submissionId: d\.submissionId/);
    assert.match(send, /attribution: firstTouchSnapshot\(\)/);
  });

  it('čte se TÝŽ snímek, který už prohlížeč má', () => {
    // Klíč i pravidlo platnosti jsou ty existující — žádné druhé úložiště
    // a žádné druhé okno platnosti.
    assert.match(reader, /localStorage\.getItem\(FIRST_TOUCH_STORE\)/);
    assert.match(reader, /firstTouchAlive\(snap\)/);
  });

  it('nic se při čtení nezakládá ani nepřepisuje', () => {
    /* Tohle je to podstatné. Kdyby čtení snímek zakládalo nebo obnovovalo
       `captured_at`, přestal by to být PRVNÍ dotyk a stal by se z něj
       posuvný poslední — a nikdo by si toho nevšiml, protože data by dál
       vypadala rozumně. */
    assert.equal(reader.includes('setItem'), false);
    assert.equal(reader.includes('captured_at'), false);
    assert.equal(reader.includes('Date.now'), false);
    assert.equal(reader.includes('URLSearchParams'), false);
  });

  it('nedostupné ani rozbité úložiště poptávku nezastaví', () => {
    // Privátní režim, zakázané úložiště, poškozený JSON — všechno končí
    // jako `null` a poptávka jde dál bez původu.
    assert.match(reader, /try\s*\{/);
    assert.match(reader, /catch\s*\(e\)\s*\{[\s\S]*return null/);
    assert.match(reader, /\|\|\s*'null'/);
  });

  it('vypršelý snímek se neposílá', () => {
    // Platnost rozhoduje `firstTouchAlive`, tedy existující 90denní okno.
    assert.match(reader, /return firstTouchAlive\(snap\) \? snap : null/);
  });

  it('okno platnosti zůstalo 90 dní a nepřepisuje se', () => {
    assert.match(FORM, /FIRST_TOUCH_MAX_AGE_MS = 90 \* 24 \* 60 \* 60 \* 1000/);
    assert.match(FORM, /if \(firstTouchAlive\(existing\)\) return;/);
  });
});

describe('konverze se hlásí jen po skutečném odeslání', () => {
  it('`inquiry_submitted` má v celém souboru jediné místo', () => {
    const calls = FORM.match(/track\('inquiry_submitted'/g) || [];
    assert.equal(calls.length, 1);
  });

  it('a to místo je až za úspěchem od Web3Forms', () => {
    // `showDone()` se volá jen po `success: true`; klepnutí na Odeslat
    // konverze není a měřit se nesmí.
    const done = body(FORM, 'showDone');
    assert.match(done, /track\('inquiry_submitted'/);
    assert.match(done, /props\.submission_id = submitted\.submissionId/);
  });

  it('selhání hlásí `inquiry_failed`, ne úspěch', () => {
    const error = body(FORM, 'showError');
    assert.match(error, /track\('inquiry_failed'/);
    assert.equal(error.includes('inquiry_submitted'), false);
  });

  it('potvrzení se volá až ZA úspěchem od Web3Forms', () => {
    /* Pořadí v úspěšné větvi: nejdřív se odmítne neúspěch výjimkou,
       teprve pak se posílá potvrzení a ukazuje úspěšná obrazovka. */
    const rejected = FORM.indexOf('throw rejected;');
    const confirm = FORM.indexOf('sendConfirmation(data);');
    const done = FORM.indexOf('showDone();');

    assert.ok(rejected > -1 && confirm > rejected, 'potvrzení se posílá i při neúspěchu');
    assert.ok(done > confirm, 'úspěšná obrazovka se ukazuje před potvrzením');
  });

  it('selhání potvrzení NEMÁ jak vyrobit falešné `inquiry_failed`', () => {
    /* Odeslání potvrzení je oddělený slib s vlastním `catch` a celé je
       navíc v `try`. I kdyby čtení snímku nebo síť selhaly, poptávka je
       v tu chvíli u Web3Forms a zákazník vidí úspěch. Selhání se hlásí
       existující událostí `confirmation_failed`, ne selháním poptávky. */
    const send = body(FORM, 'sendConfirmation');

    assert.match(send, /try \{/);
    assert.match(send, /\.catch\(function \(\) \{/);
    assert.match(send, /track\('confirmation_failed'/);
    assert.equal(send.includes("track('inquiry_failed'"), false);
    assert.equal(send.includes('showError'), false);
  });
});

describe('identifikátor odeslání', () => {
  it('je náhodný a vzniká jednou za odeslání', () => {
    assert.match(FORM, /data\.submissionId = newSubmissionId\(\);/);
    assert.match(body(FORM, 'newSubmissionId'), /randomUUID|getRandomValues/);
  });

  it('tatáž hodnota jde do PostHogu i do těla poptávky', () => {
    /* Celá spojka stojí na tom, že je to JEDNA hodnota. V PostHogu
       `submission_id` u konverze, v CRM sloupec `submission_id`. */
    assert.match(body(FORM, 'showDone'), /props\.submission_id = submitted\.submissionId/);
    assert.match(body(FORM, 'sendConfirmation'), /submissionId: d\.submissionId/);
  });
});

describe('do analytiky nejde nic osobního', () => {
  it('snímek se posílá tak, jak je — formulář se do něj nepřimíchá', () => {
    const send = body(FORM, 'sendConfirmation');
    const attribution = send.slice(send.indexOf('attribution:'));

    // Za `attribution:` stojí volání čtečky, ne skládání objektu z `d`.
    assert.match(attribution, /^attribution: firstTouchSnapshot\(\)/);
    for (const pii of ['d.jmeno', 'd.email', 'd.telefon', 'd.mesto', 'd.psc', 'd.popis']) {
      assert.equal(attribution.split('\n')[0].includes(pii), false, pii);
    }
  });

  it('konverze nese jen kategorie, žádný volný text', () => {
    const done = body(FORM, 'showDone');
    for (const pii of ['jmeno', 'email', 'telefon', 'mesto', 'psc', 'popis', 'zarizeni']) {
      assert.equal(done.includes('submitted.' + pii), false, pii);
    }
  });

  it('do snímku se neukládá HODNOTA kliku z reklamy, jen jeho název', () => {
    // `snap.click_id = k`, kde `k` je 'gclid' nebo 'fbclid' — nikdy `q.get(k)`.
    assert.match(FORM, /\['gclid', 'fbclid'\]\.forEach\(function \(k\) \{ if \(q\.get\(k\)\) snap\.click_id = k; \}\)/);
  });
});

describe('základ z Fáze 1 zůstal nedotčený', () => {
  it('analytika běží jen na produkční doméně', () => {
    assert.match(INDEX, /if \(h !== 'md-therm\.cz' && h !== 'www\.md-therm\.cz'\) return;/);
  });

  it('jedno načtení dokumentu = jeden pageview, kotvy nepočítají', () => {
    /* Web je jedna stránka s kotvami (#sluzby, #poptavka…). Režim
       `history_change` by z každé kotvy udělal další pageview — proto se
       hlídá HODNOTA nastavení, ne zmínka v komentáři nad ním. */
    assert.match(INDEX, /capture_pageview: true/);
    assert.equal(INDEX.includes("capture_pageview: 'history_change'"), false);
  });

  it('autocapture a nahrávání relací zůstávají vypnuté', () => {
    assert.match(INDEX, /autocapture: false/);
    assert.match(INDEX, /disable_session_recording: true/);
  });

  it('profily jen u identifikovaných', () => {
    assert.match(INDEX, /person_profiles: 'identified_only'/);
  });
});
