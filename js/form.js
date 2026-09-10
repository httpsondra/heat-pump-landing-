/* =========================================================================
   MD-Therm — poptávkový formulář, FAQ a mobilní lišta
   ---------------------------------------------------------------------
   Vlastní soubor schválně: main.js se v mobilním / reduced-motion režimu
   ukončuje brzkým `return` (scrub hero se tam nespouští). Kdyby tahle
   logika žila na jeho konci, na telefonech by vůbec neexistovala — tedy
   přesně tam, kde je poptávka nejdůležitější.
   ========================================================================= */
(function () {
  'use strict';

  var doc = document, html = doc.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =======================================================================
     ANALYTIKA
     -----------------------------------------------------------------------
     Posílají se jen vlastní pojmenované události (autocapture je vypnutý)
     a jen nepovinné kategorie — nikdy jméno, telefon, e-mail, město, PSČ
     ani volný text. Schéma popisuje docs/analytics.md.

     PostHog se stahuje až v nečinnosti, takže v prvních vteřinách ještě
     nemusí existovat. Kdo ťukne na „Zavolat" hned po načtení, by o událost
     přišel — proto fronta. index.html po inicializaci zavolá flush.
     ======================================================================= */
  var ANALYTICS_QUEUE = [];
  var QUEUE_MAX = 20;                  // pojistka, kdyby PostHog nedorazil vůbec

  function posthogReady() {
    return !!(window.posthog && typeof window.posthog.capture === 'function');
  }
  function track(name, props) {
    try {
      if (posthogReady()) { window.posthog.capture(name, props || {}); return; }
      if (ANALYTICS_QUEUE.length < QUEUE_MAX) ANALYTICS_QUEUE.push([name, props || {}]);
    } catch (e) { /* analytika nikdy nesmí shodit formulář */ }
  }
  window.__mdthermFlush = function () {
    try {
      if (!posthogReady()) return;
      while (ANALYTICS_QUEUE.length) {
        var ev = ANALYTICS_QUEUE.shift();
        window.posthog.capture(ev[0], ev[1]);
      }
    } catch (e) {}
  };

  /* České popisky → stabilní klíče. Kdyby se text volby přepsal, report se
     nerozpadne. Neznámá hodnota končí jako 'other' — nikdy se neposílá
     surový text formuláře. Po přidání volby doplnit i sem. */
  var SERVICE_KEYS = {
    'Tepelné čerpadlo': 'heat_pump', 'Klimatizace': 'air_conditioning',
    'Plynový kotel': 'gas_boiler', 'Servis nebo oprava': 'service',
    'Nejsem si jistý': 'unsure'
  };
  var BUILDING_KEYS = {
    'Rodinný dům': 'house', 'Byt': 'apartment',
    'Firemní objekt': 'commercial', 'Jiný objekt': 'other_building'
  };
  var SITUATION_KEYS = {
    'Zjišťuji možnosti': 'exploring', 'Stavím nebo rekonstruuji': 'building_renovating',
    'Měním starý zdroj tepla': 'replacing_source', 'Chci nacenit konkrétní řešení': 'quote_request',
    'Zařízení nefunguje': 'not_working', 'Hlásí chybu': 'error_code',
    'Divný zvuk nebo slabý výkon': 'poor_performance', 'Pravidelná prohlídka nebo revize': 'maintenance'
  };
  /* Slug z karty služby (data-sluzba) → stejné klíče jako výše. */
  var CARD_SERVICE_KEYS = {
    'tepelne-cerpadlo': 'heat_pump', 'klimatizace': 'air_conditioning',
    'plynovy-kotel': 'gas_boiler', 'servis': 'service'
  };
  function normalize(map, value) {
    if (!value) return undefined;
    return map[value] || 'other';
  }

  /* Důvody selhání — uzavřený číselník. Do analytiky se NIKDY nesmí dostat
     text výjimky ani odpověď poskytovatele: nese cizí formulace, mění se bez
     naší kontroly a rozstřelil by kardinalitu události. Cokoli mimo seznam
     spadne na 'unknown'. */
  var FAIL_REASONS = ['network_error', 'provider_rejected', 'timeout', 'missing_config', 'unknown'];
  function failReason(r) {
    return FAIL_REASONS.indexOf(r) >= 0 ? r : 'unknown';
  }

  /* Kontext jednoho pokusu o poptávku: odkud člověk k formuláři přišel.
     Vlastní klíč (ne koncept `save()`), aby obnova rozepsané poptávky
     nezačala omylem považovat pouhý klik na CTA za zahájený formulář. */
  var CTX_STORE = 'md-poptavka-ctx-v1';
  function readCtx() {
    try { return JSON.parse(sessionStorage.getItem(CTX_STORE) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeCtx(patch) {
    try {
      var c = readCtx();
      Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
      sessionStorage.setItem(CTX_STORE, JSON.stringify(c));
    } catch (e) {}
  }
  function clearCtx() { try { sessionStorage.removeItem(CTX_STORE); } catch (e) {} }

  /* Vlastnosti, které nese inquiry_started i inquiry_submitted. */
  function ctxProps() {
    var c = readCtx();
    var p = { entry_point: c.entry_point || 'direct' };
    if (c.service) p.service = c.service;
    return p;
  }

  /* -----------------------------------------------------------------------
     První dotyk (first-touch) — podklad pro pozdější spojení s CRM.
     Drží kampaň, přes kterou člověk přišel poprvé, i když se pak vrátí přímo.
     Platnost 90 dní: uvnitř okna se nepřepisuje, po vypršení smí příští
     návštěva založit nový snímek. Jen marketingové
     parametry, žádné osobní údaje. Ve Fázi 1 se nikam neodesílá — čeká na
     rozšíření CRM kontraktu. Podrobnosti v docs/analytics.md.
     ----------------------------------------------------------------------- */
  var FIRST_TOUCH_STORE = 'md-first-touch-v1';
  var FIRST_TOUCH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;   // 90 dní

  /* Platí, dokud je snímku míň než 90 dní. Uvnitř okna se NEPŘEPISUJE ani
     neobnovuje `captured_at` — jinak by z prvního dotyku vznikl posuvný
     poslední dotyk. Po vypršení smí příští návštěva založit nový. */
  function firstTouchAlive(snap) {
    if (!snap || !snap.captured_at) return false;
    var t = Date.parse(snap.captured_at);
    if (!t) return false;
    return (Date.now() - t) < FIRST_TOUCH_MAX_AGE_MS;
  }

  (function captureFirstTouch() {
    try {
      var existing = null;
      try { existing = JSON.parse(localStorage.getItem(FIRST_TOUCH_STORE) || 'null'); } catch (e) {}
      if (firstTouchAlive(existing)) return;               // v okně → nesahat

      var q = new URLSearchParams(location.search);
      var snap = { captured_at: new Date().toISOString(), landing_page: location.pathname };
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
        var v = q.get(k); if (v) snap[k] = String(v).slice(0, 120);
      });
      ['gclid', 'fbclid'].forEach(function (k) { if (q.get(k)) snap.click_id = k; });
      var ref = doc.referrer || '';
      if (ref) { try { snap.initial_referrer = new URL(ref).hostname; } catch (e) {} }
      localStorage.setItem(FIRST_TOUCH_STORE, JSON.stringify(snap));
    } catch (e) { /* privátní režim / zakázané úložiště — analytika se nevnucuje */ }
  })();

  /* -----------------------------------------------------------------------
     Telefon a e-mail — jedno jméno události, místo nese vlastnost.
     Delegovaně na dokumentu: odkazů je jedenáct a jsou i ve stavech, které
     v DOM vzniknou až po odeslání (úspěch/chyba).
     ----------------------------------------------------------------------- */
  function contactLocation(el) {
    if (el.closest('#mobilebar')) return 'mobilebar';
    if (el.closest('.topbar')) return 'topbar';
    if (el.closest('#hero')) return 'hero';
    if (el.closest('#inquiryDone')) return 'form_success';
    if (el.closest('#inquiryError')) return 'form_error';
    if (el.closest('#poptavka')) return 'form_urgent';
    if (el.closest('.cta-band')) return 'cta_band';
    if (el.closest('#kontakt')) return 'contact';
    if (el.closest('.footer')) return 'footer';
    return 'other';
  }
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"], a[href^="mailto:"]');
    if (!a) return;
    var isTel = a.getAttribute('href').indexOf('tel:') === 0;
    track(isTel ? 'phone_clicked' : 'email_clicked', { location: contactLocation(a) });
  });

  /* Odkud člověk míří do formuláře. Samo o sobě to není zahájená poptávka —
     jen se poznamená kontext a čeká se na skutečnou interakci s formulářem. */
  var ENTRY_POINTS = [
    ['#mobilebar', 'mobilebar'], ['.topbar', 'topbar'], ['#hero', 'hero'],
    ['#sluzby', 'services'], ['#rozhodovani', 'comparison'],
    ['.cta-band', 'cta_band'], ['#kontakt', 'contact']
  ];
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#poptavka"]');
    if (!a) return;
    var patch = { entry_point: 'other' };
    for (var i = 0; i < ENTRY_POINTS.length; i++) {
      if (a.closest(ENTRY_POINTS[i][0])) { patch.entry_point = ENTRY_POINTS[i][1]; break; }
    }
    var slug = a.getAttribute('data-sluzba');
    if (slug && CARD_SERVICE_KEYS[slug]) patch.service = CARD_SERVICE_KEYS[slug];
    writeCtx(patch);
  });

  /* =======================================================================
     ODESLÁNÍ POPTÁVKY — konfigurace
     -----------------------------------------------------------------------
     Poptávka se odesílá na pozadí přes Web3Forms (žádný vlastní backend).

     NASTAVENÍ (jednorázově, ~5 minut):
       1) Na https://web3forms.com nechat vygenerovat access key na adresu
          dusek@md-therm.cz (klíč přijde e-mailem).
       2) Vložit ho níže do WEB3FORMS_ACCESS_KEY.
       3) Zvýšit ?v= u js/form.js v index.html, ať se nová verze nekešuje.
       CSP už api.web3forms.com povoluje (connect-src ve vercel.json),
       nic dalšího se měnit nemusí.

     Access key je veřejný identifikátor formuláře, ne tajemství — může být
     v klientském kódu. Proti robotům slouží honeypot pole `web` níže.

     Kdyby byl klíč někdy prázdný, formulář se tváří jako nenakonfigurovaný:
     NEODESLÁ nic, NEPŘEDSTÍRÁ úspěch a neotevírá e-mailového klienta —
     ukáže chybový stav, aby si toho někdo všiml dřív než zákazník.

     Access key je veřejný identifikátor formuláře (chodí v těle požadavku
     z prohlížeče), ne tajemství. Změnit se dá v účtu na web3forms.com.
     ======================================================================= */
  var WEB3FORMS_ACCESS_KEY = '8f1198f1-ae3c-41a8-8ef9-ffc1b1c46d75';
  var WEB3FORMS_ENDPOINT   = 'https://api.web3forms.com/submit';
  var SUBMIT_TIMEOUT_MS    = 15000;

  /* =======================================================================
     FAQ akordeon
     ======================================================================= */
  (function initFaq() {
    var list = doc.getElementById('faqList');
    if (!list) return;
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('.faq__q');
      if (!btn || !list.contains(btn)) return;
      var panel = doc.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      var item = btn.closest('.faq__item');
      if (open) {
        item.classList.remove('is-open');
        // `hidden` až po doběhnutí animace výšky, jinak by zmizel skokem
        if (reduced) panel.hidden = true;
        else window.setTimeout(function () {
          if (btn.getAttribute('aria-expanded') === 'false') panel.hidden = true;
        }, 380);
      } else {
        panel.hidden = false;
        // vynutit reflow, aby přechod 0fr → 1fr proběhl
        void panel.offsetHeight;
        item.classList.add('is-open');
      }
    });
  })();

  /* =======================================================================
     Fixní mobilní lišta
     ======================================================================= */
  (function initBar() {
    var bar = doc.getElementById('mobilebar');
    var hero = doc.getElementById('hero');
    var formSec = doc.getElementById('poptavka');
    var footer = doc.querySelector('.footer');
    if (!bar || !('IntersectionObserver' in window)) return;

    // Lišta se ukáže, až hero opustí obrazovku, a schová se nad formulářem
    // a nad patičkou — tam už má uživatel vlastní, konkrétnější akci.
    var state = { hero: true, form: false, footer: false, keyboard: false };
    function apply() {
      var show = !state.hero && !state.form && !state.footer && !state.keyboard;
      html.classList.toggle('bar-on', show);
    }
    function watch(el, key, threshold) {
      if (!el) return;
      new IntersectionObserver(function (entries) {
        state[key] = entries[0].isIntersecting;
        apply();
      }, { threshold: threshold }).observe(el);
    }
    watch(hero, 'hero', 0);
    watch(formSec, 'form', 0.2);
    watch(footer, 'footer', 0);

    // Otevřená softwarová klávesnice na Androidu vytlačí fixní lištu nad pole,
    // do kterého se právě píše — na dobu psaní ji proto schováme.
    doc.addEventListener('focusin', function (e) {
      if (e.target.matches('input, textarea, select')) { state.keyboard = true; apply(); }
    });
    doc.addEventListener('focusout', function (e) {
      if (e.target.matches('input, textarea, select')) {
        window.setTimeout(function () {
          if (!doc.activeElement || !doc.activeElement.matches('input, textarea, select')) {
            state.keyboard = false; apply();
          }
        }, 120);
      }
    });
    apply();
  })();

  /* =======================================================================
     Poptávkový formulář — stavový automat
     ======================================================================= */
  var form = doc.getElementById('inquiryForm');
  if (!form) return;

  var TOTAL = 6;
  var LABELS = ['Služba', 'Objekt', 'Situace', 'Místo', 'Detaily', 'Kontakt'];

  var railSegs = Array.prototype.slice.call(doc.querySelectorAll('#inquiryRail .inquiry__seg'));
  var panels   = Array.prototype.slice.call(form.querySelectorAll('.inquiry__panel'));
  var stepEl   = doc.getElementById('inquiryStep');
  var backBtn  = doc.getElementById('inquiryBack');
  var nextBtn  = doc.getElementById('inquiryNext');
  var submitBtn= doc.getElementById('inquirySubmit');
  var alertEl  = doc.getElementById('inquiryAlert');
  var doneEl   = doc.getElementById('inquiryDone');
  var errorEl  = doc.getElementById('inquiryError');
  var retryBtn = doc.getElementById('inquiryRetry');
  var summaryEl= doc.getElementById('inquirySummary');
  var navEl    = doc.getElementById('inquiryNav');
  var railEl   = doc.getElementById('inquiryRail');
  var metaEl   = form.querySelector('.inquiry__meta');

  var step = 1;                 // 1..6
  var branch = 'instalace';     // která varianta kroku 3
  var started = false;
  var STORE = 'md-poptavka-v1';

  /* ---- uložení rozepsané poptávky ----
     main.js při překročení 860 px stránku reloaduje (pin scrubu vs. mobilní
     layout nejdou skloubit). Otočení tabletu uprostřed formuláře by jinak
     smazalo všechny odpovědi. */
  function save() {
    try {
      var d = { step: step, branch: branch, v: {} };
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.name === 'web') return;
        if (el.type === 'radio') { if (el.checked) d.v[el.name] = el.value; }
        else d.v[el.name] = el.value;
      });
      sessionStorage.setItem(STORE, JSON.stringify(d));
    } catch (e) {}
  }
  function restore() {
    try {
      var d = JSON.parse(sessionStorage.getItem(STORE) || 'null');
      if (!d || !d.v) return;
      Object.keys(d.v).forEach(function (k) {
        var els = form.elements[k];
        if (!els) return;
        if (els.length && els[0] && els[0].type === 'radio') {
          Array.prototype.forEach.call(els, function (el) {
            if (el.value === d.v[k]) { el.checked = true; }
          });
        } else if (els.type === 'radio') {
          if (els.value === d.v[k]) els.checked = true;
        } else { els.value = d.v[k]; }
      });
      branch = d.branch || 'instalace';
      step = Math.min(TOTAL, Math.max(1, d.step || 1));
      started = true;
    } catch (e) {}
  }
  function clearSaved() { try { sessionStorage.removeItem(STORE); } catch (e) {} }

  /* ---- výběr aktivního panelu ---- */
  function panelFor(n) {
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (Number(p.getAttribute('data-step')) !== n) continue;
      var v = p.getAttribute('data-variant');
      if (!v || v === branch) return p;
    }
    return null;
  }

  /* Skryté varianty kroku 3 musí mít disabled inputy — jinak zůstanou
     v tab orderu a mohly by se odeslat spolu s viditelnou variantou. */
  function syncBranch() {
    panels.forEach(function (p) {
      var v = p.getAttribute('data-variant');
      if (!v) return;
      var off = v !== branch;
      Array.prototype.forEach.call(p.querySelectorAll('input'), function (i) {
        i.disabled = off;
        if (off) i.checked = false;
      });
    });
  }

  function setAlert(msg) {
    if (!msg) { alertEl.hidden = true; alertEl.textContent = ''; return; }
    alertEl.textContent = msg;
    alertEl.hidden = false;
  }

  function fieldError(id, msg) {
    var input = doc.getElementById('f-' + id);
    var err = doc.getElementById('e-' + id);
    if (!input || !err) return;
    err.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  /* =======================================================================
     Telefon — průběžné formátování na české 600 700 800
     -----------------------------------------------------------------------
     Zobrazená hodnota je vždy jen 9 číslic po trojicích. Předvolba se do pole
     nepíše (ani jako placeholder), ale vloží-li ji uživatel přes schránku,
     tiše se odřízne. Interně se drží normalizovaný tvar +420600700800.
     ======================================================================= */
  var telEl = doc.getElementById('f-telefon');

  function telDigits(raw) {
    var d = String(raw == null ? '' : raw).replace(/\D/g, '');
    // +420 / 420 / 00420 na začátku = česká předvolba, ne první číslice čísla
    if (d.indexOf('00420') === 0) d = d.slice(5);
    else if (d.indexOf('420') === 0 && d.length > 9) d = d.slice(3);
    return d.slice(0, 9);
  }
  function telGroup(digits) {
    return digits.replace(/(\d{3})(?=\d)/g, '$1 ');
  }
  function telDisplay() { return telEl ? telEl.value.trim() : ''; }
  function telE164() {
    var d = telDigits(telEl ? telEl.value : '');
    return d.length === 9 ? '+420' + d : '';
  }

  /* Přeformátuje pole a udrží kurzor u stejné číslice, u které stál.
     Bez toho kurzor po každé mezeře odskakuje na konec. */
  function telFormat(caretDigits) {
    if (!telEl) return;
    var digits = telDigits(telEl.value);
    var out = telGroup(digits);
    if (caretDigits == null) {
      var before = telEl.value.slice(0, telEl.selectionStart == null ? telEl.value.length : telEl.selectionStart);
      caretDigits = telDigits(before).length;
      // Když se odřízla předvolba, posune se o ni i kurzor.
      var rawBefore = before.replace(/\D/g, '');
      var rawAll = telEl.value.replace(/\D/g, '');
      if (rawAll.indexOf('420') === 0 && rawAll.length > 9 && rawBefore.indexOf('420') === 0) {
        caretDigits = Math.max(0, rawBefore.length - 3);
      }
    }
    caretDigits = Math.max(0, Math.min(caretDigits, digits.length));
    telEl.value = out;
    // Kurzor za N-tou číslici (mezery přeskočí).
    var pos = 0, seen = 0;
    while (pos < out.length && seen < caretDigits) {
      if (/\d/.test(out.charAt(pos))) seen++;
      pos++;
    }
    try { telEl.setSelectionRange(pos, pos); } catch (e) { /* pole není zaměřené */ }
  }

  if (telEl) {
    telEl.addEventListener('input', function () { telFormat(); });

    /* Backspace přes mezeru musí smazat číslici před ní, ne jen mezeru —
       jinak se první stisk „nic nestane" a působí to rozbitě. */
    telEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (telEl.selectionStart !== telEl.selectionEnd) return;   // výběr řeší prohlížeč
      var pos = telEl.selectionStart;
      if (e.key === 'Backspace' && pos > 0 && telEl.value.charAt(pos - 1) === ' ') {
        e.preventDefault();
        var d = telDigits(telEl.value);
        var idx = telDigits(telEl.value.slice(0, pos)).length;     // číslic vlevo
        telEl.value = telGroup(d.slice(0, idx - 1) + d.slice(idx));
        telFormat(Math.max(0, idx - 1));
      } else if (e.key === 'Delete' && telEl.value.charAt(pos) === ' ') {
        e.preventDefault();
        var d2 = telDigits(telEl.value);
        var idx2 = telDigits(telEl.value.slice(0, pos)).length;    // číslic vlevo
        telEl.value = telGroup(d2.slice(0, idx2) + d2.slice(idx2 + 1));
        telFormat(idx2);
      }
    });

    // Vložení ze schránky: nechat prohlížeč vložit, pak srovnat na konci tiku.
    telEl.addEventListener('paste', function () { window.setTimeout(function () { telFormat(); }, 0); });
    telEl.addEventListener('blur', function () { telFormat(telDigits(telEl.value).length); });
  }

  /* =======================================================================
     PSČ — průběžné formátování na 141 00
     -----------------------------------------------------------------------
     Stejné chování jako u telefonu výš, jen jiné seskupení (3 + 2) a bez
     předvolby. Pole zůstává nepovinné; když se vyplní, musí mít pět číslic.
     ======================================================================= */
  var pscEl = doc.getElementById('f-psc');

  function pscDigits(raw) {
    return String(raw == null ? '' : raw).replace(/\D/g, '').slice(0, 5);
  }
  function pscGroup(digits) {
    return digits.length > 3 ? digits.slice(0, 3) + ' ' + digits.slice(3) : digits;
  }

  /* Přeformátuje pole a nechá kurzor u stejné číslice, u které stál. */
  function pscFormat(caretDigits) {
    if (!pscEl) return;
    var digits = pscDigits(pscEl.value);
    var out = pscGroup(digits);
    if (caretDigits == null) {
      var before = pscEl.value.slice(0, pscEl.selectionStart == null ? pscEl.value.length : pscEl.selectionStart);
      caretDigits = pscDigits(before).length;
    }
    caretDigits = Math.max(0, Math.min(caretDigits, digits.length));
    pscEl.value = out;
    var pos = 0, seen = 0;
    while (pos < out.length && seen < caretDigits) {
      if (/\d/.test(out.charAt(pos))) seen++;
      pos++;
    }
    try { pscEl.setSelectionRange(pos, pos); } catch (e) { /* pole není zaměřené */ }
  }

  if (pscEl) {
    pscEl.addEventListener('input', function () { pscFormat(); });

    /* Backspace přes mezeru smaže číslici před ní, Delete číslici za ní —
       jinak první stisk zdánlivě nic neudělá. */
    pscEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (pscEl.selectionStart !== pscEl.selectionEnd) return;   // výběr řeší prohlížeč
      var pos = pscEl.selectionStart;
      if (e.key === 'Backspace' && pos > 0 && pscEl.value.charAt(pos - 1) === ' ') {
        e.preventDefault();
        var d = pscDigits(pscEl.value);
        var idx = pscDigits(pscEl.value.slice(0, pos)).length;    // číslic vlevo
        pscEl.value = pscGroup(d.slice(0, idx - 1) + d.slice(idx));
        pscFormat(Math.max(0, idx - 1));
      } else if (e.key === 'Delete' && pscEl.value.charAt(pos) === ' ') {
        e.preventDefault();
        var d2 = pscDigits(pscEl.value);
        var idx2 = pscDigits(pscEl.value.slice(0, pos)).length;   // číslic vlevo
        pscEl.value = pscGroup(d2.slice(0, idx2) + d2.slice(idx2 + 1));
        pscFormat(idx2);
      }
    });

    pscEl.addEventListener('paste', function () { window.setTimeout(function () { pscFormat(); }, 0); });
    pscEl.addEventListener('blur', function () { pscFormat(pscDigits(pscEl.value).length); });
  }

  /* ---- validace jednotlivých kroků ---- */
  function validate(n) {
    setAlert('');
    ['mesto', 'psc', 'jmeno', 'telefon', 'email'].forEach(function (k) { fieldError(k, ''); });

    if (n === 1 || n === 2 || n === 3) {
      var name = n === 1 ? 'sluzba' : (n === 2 ? 'objekt' : 'situace');
      if (!form.querySelector('input[name="' + name + '"]:checked')) {
        setAlert('Vyberte prosím jednu možnost.');
        return false;
      }
      return true;
    }
    if (n === 4) {
      var mesto = doc.getElementById('f-mesto').value.trim();
      var psc = doc.getElementById('f-psc').value.trim();
      var ok = true;
      if (!mesto) { fieldError('mesto', 'Doplňte prosím město nebo obec.'); ok = false; }
      if (psc && pscDigits(psc).length !== 5) { fieldError('psc', 'PSČ zadejte prosím jako pět číslic, např. 141 00.'); ok = false; }
      if (!ok) setAlert('Zkontrolujte prosím označená pole.');
      return ok;
    }
    if (n === 5) return true;                    // celý krok je nepovinný
    if (n === 6) {
      var jm = doc.getElementById('f-jmeno').value.trim();
      var tel = doc.getElementById('f-telefon').value.trim();
      var em = doc.getElementById('f-email').value.trim();
      var ok2 = true;
      if (!jm) { fieldError('jmeno', 'Doplňte prosím jméno.'); ok2 = false; }
      if (!tel) { fieldError('telefon', 'Doplňte prosím telefon, ať se vám máme kam ozvat.'); ok2 = false; }
      else if (telDigits(tel).length !== 9) { fieldError('telefon', 'Zadejte prosím devítimístné číslo, například 600 700 800.'); ok2 = false; }
      /* E-mail je nově povinný — chodí na něj potvrzení poptávky. */
      if (!em) { fieldError('email', 'Doplňte prosím e-mail, pošleme na něj potvrzení.'); ok2 = false; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { fieldError('email', 'Zkontrolujte prosím tvar e-mailu.'); ok2 = false; }
      if (!ok2) {
        setAlert('Zkontrolujte prosím označená pole.');
        var first = form.querySelector('[aria-invalid="true"]');
        if (first) first.focus();
      }
      return ok2;
    }
    return true;
  }

  /* ---- souhrn na posledním kroku ---- */
  function renderSummary() {
    if (!summaryEl) return;
    var picks = ['sluzba', 'objekt', 'situace'].map(function (n) {
      var el = form.querySelector('input[name="' + n + '"]:checked');
      return el ? el.value : null;
    });
    var mesto = doc.getElementById('f-mesto').value.trim();
    if (mesto) picks.push(mesto);
    summaryEl.innerHTML = '';
    picks.filter(Boolean).forEach(function (v) {
      var s = doc.createElement('span');
      s.className = 'inquiry__chip';
      s.textContent = v;
      summaryEl.appendChild(s);
    });
  }

  /* ---- vykreslení kroku ---- */
  function render(focusIt) {
    panels.forEach(function (p) { p.hidden = true; });
    var active = panelFor(step);
    if (active) active.hidden = false;

    railSegs.forEach(function (seg, i) {
      seg.classList.toggle('is-done', i < step - 1);
      seg.classList.toggle('is-now', i === step - 1);
    });
    stepEl.textContent = 'Krok ' + step + ' z ' + TOTAL + ' — ' + LABELS[step - 1];

    backBtn.hidden = step === 1;
    var last = step === TOTAL;
    nextBtn.hidden = last;
    submitBtn.hidden = !last;
    // Nepovinnost 5. kroku nesou popisky polí „(nepovinné)", tlačítko ji
    // nemusí opakovat.
    nextBtn.textContent = 'Pokračovat';
    if (last) renderSummary();

    if (focusIt && active) {
      var legend = active.querySelector('.inquiry__q');
      // Fokus na nadpis kroku, ne na první pole: fokus v poli by na mobilu
      // hned vytáhl klávesnici a schoval otázku, kterou má člověk přečíst.
      if (legend) legend.focus({ preventScroll: true });
      keepInView();
    }
    save();
  }

  /* Karta se mezi kroky liší výškou. Skákat na její začátek při každém kroku
     je na mobilu nepříjemné — posuneme jen tehdy, když karta utekla z dohledu. */
  function keepInView() {
    var card = form.getBoundingClientRect();
    if (card.top < 70 || card.top > window.innerHeight * 0.65) {
      window.scrollTo({ top: window.scrollY + card.top - 90, behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  function go(n, focusIt, silent) {
    var from = step;
    step = Math.min(TOTAL, Math.max(1, n));
    setAlert('');
    render(focusIt !== false);
    /* Jen posun vpřed a jen číslo — u šestikrokového formuláře je vidět,
       kde lidé odpadají, a nic z toho nenese obsah odpovědí.
       `silent` je pro skok z karty služby: ten krok vyplnil program, ne
       člověk, a měřit ho dřív než inquiry_started by nafouklo trychtýř. */
    if (step > from && !silent) track('inquiry_step_completed', { step: from });
  }

  /* ---- ovládání ---- */
  nextBtn.addEventListener('click', function () { if (validate(step)) go(step + 1); });
  backBtn.addEventListener('click', function () { go(step - 1); });

  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'sluzba') {
      branch = t.getAttribute('data-next') || 'instalace';
      syncBranch();
    }
    if (!started) { started = true; track('inquiry_started', ctxProps()); }
    save();

    // Automatický posun u kroků s jedinou volbou — ušetří polovinu kliků.
    // Krátká prodleva, aby byl vybraný stav vidět, než se krok přepne.
    if (t.type === 'radio' && step <= 3) {
      window.setTimeout(function () {
        if (form.querySelector('input[name="' + t.name + '"]:checked') === t) go(step + 1);
      }, reduced ? 0 : 260);
    }
  });

  form.addEventListener('input', function () {
    if (!started) { started = true; track('inquiry_started', ctxProps()); }
    save();
  });

  // Enter v textovém poli posune na další krok místo odeslání formuláře
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target.tagName === 'TEXTAREA') return;
    if (step < TOTAL) { e.preventDefault(); if (validate(step)) go(step + 1); }
  });

  /* Náhodný identifikátor JEDNOHO odeslání.
     Server si z něj udělá klíč pro CRM (Idempotency-Key), takže když se
     tentýž požadavek doručí dvakrát, vznikne v CRM jen jedna poptávka.
     Není to identifikátor člověka ani zařízení — vzniká při odeslání
     a nikam se neukládá. */
  function newSubmissionId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      if (window.crypto && window.crypto.getRandomValues) {
        var a = new Uint8Array(16);
        window.crypto.getRandomValues(a);
        return Array.prototype.map.call(a, function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      }
    } catch (e) { /* projde se na náhradní řešení níž */ }
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  /* ---- sestavení poptávky ---- */
  function collect() {
    function val(id) { var el = doc.getElementById('f-' + id); return el ? el.value.trim() : ''; }
    function radio(n) { var el = form.querySelector('input[name="' + n + '"]:checked'); return el ? el.value : ''; }
    return {
      sluzba: radio('sluzba'), objekt: radio('objekt'), situace: radio('situace'),
      mesto: val('mesto'), psc: val('psc'), popis: val('popis'), zarizeni: val('zarizeni'),
      jmeno: val('jmeno'),
      telefon: telDisplay(),          // čitelně: 600 700 800
      telefonE164: telE164(),         // strojově: +420600700800 (pro CRM)
      email: val('email')
    };
  }

  /* Payload pro Web3Forms.
     -----------------------------------------------------------------------
     Web3Forms vypíše do notifikačního e-mailu KAŽDÉ pole, které není jeho
     vlastní řídicí (access_key, subject, from_name, email, replyto, redirect,
     botcheck, attachment, webhook). Neexistuje způsob, jak pole odeslat
     a zároveň ho z e-mailu vynechat, a vlastní šablona e-mailu je placená
     funkce nastavovaná v účtu Web3Forms, ne přes API.

     Proto je struktura payloadu zároveň strukturou e-mailu:
       · názvy klíčů jsou rovnou české popisky, které se v e-mailu zobrazí,
       · pořadí klíčů = pořadí řádků v e-mailu,
       · nepovinná prázdná pole se neposílají, ať nevznikají prázdné řádky,
       · technické údaje jsou úplně dole,
       · souhrnné pole `message` je pryč — dublovalo úplně všechno ostatní.

     `email` musí zůstat přesně pod tímhle názvem: Web3Forms podle něj
     nastavuje Reply-To a posílá autoresponder (potvrzení zákazníkovi). */
  function payload(d) {
    var p = {
      /* Řídicí pole Web3Forms — do těla e-mailu se nevypisují. */
      access_key: WEB3FORMS_ACCESS_KEY,
      subject: 'Nová poptávka — ' + (d.sluzba || 'neurčeno') + (d.mesto ? ' — ' + d.mesto : ''),
      from_name: 'Web MD-Therm'
    };

    /* Obsah poptávky v pořadí, v jakém se má číst. */
    p['Služba']  = d.sluzba  || '—';
    p['Objekt']  = d.objekt  || '—';
    p['Situace'] = d.situace || '—';
    /* PSČ se píše po trojici a dvojici (141 00) bez ohledu na to,
       jak ho člověk zadal. */
    var psc = String(d.psc || '').replace(/\D/g, '');
    if (psc.length === 5) psc = psc.slice(0, 3) + ' ' + psc.slice(3);
    p['Lokalita'] = d.mesto + (psc ? ', ' + psc : '');
    if (d.zarizeni) p['Zařízení'] = d.zarizeni;
    if (d.popis)    p['Popis']    = d.popis;
    p['Jméno']   = d.jmeno;
    p['Telefon'] = d.telefon;
    p.email      = d.email;          /* reply-to + autoresponder — název neměnit */

    /* Technické údaje naspodu — pro CRM a ladění, ne pro čtení. */
    p['Telefon (mezinárodně)'] = d.telefonE164;
    p['Zdroj']   = 'web';
    p['Stránka'] = location.origin + location.pathname;
    return p;
  }

  /* =======================================================================
     Potvrzovací e-mail zákazníkovi
     -----------------------------------------------------------------------
     Volá se AŽ POTÉ, co Web3Forms potvrdí přijetí poptávky. Poptávka je
     v tu chvíli bezpečně zachycená, takže tenhle krok už je jen bonus:
     když selže, zákazník o tom nesmí vědět a úspěšná obrazovka se ukáže
     tak jako tak. Proto se na výsledek nečeká a chyba se jen zaznamená.

     Endpoint kromě potvrzení posílá i kopii poptávky do CRM. Obojí běží
     na serveru: klíč k Resendu ani tajemství pro CRM se do prohlížeče
     nikdy nedostanou. */
  function sendConfirmation(d) {
    try {
      fetch('/api/potvrzeni', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,          /* přežije i odklik ze stránky */
        body: JSON.stringify({
          jmeno: d.jmeno, email: d.email, sluzba: d.sluzba, objekt: d.objekt,
          situace: d.situace, mesto: d.mesto, psc: d.psc,
          /* nepovinná pole z 5. kroku */
          popis: d.popis, zarizeni: d.zarizeni,
          /* Telefon do potvrzovacího e-mailu nepatří (a nevypisuje se v něm),
             ale CRM ho vyžaduje — server ho předá dál a nikam jinam. */
          telefon: d.telefon, telefonE164: d.telefonE164,
          /* Identita jednoho odeslání kvůli idempotenci na straně CRM. */
          submissionId: d.submissionId
        })
      }).then(function (r) {
        /* Úspěch se nehlásí — zajímavé je jen selhání: poptávka je ve
           Web3Forms, ale potvrzení/kopie do CRM neprošly. */
        if (!r.ok) track('confirmation_failed', { status: Number(r.status) || 'unknown' });
      }).catch(function () {
        track('confirmation_failed', { status: 'network_error' });
      });
    } catch (e) { /* potvrzení nikdy nesmí shodit odeslání poptávky */ }
  }

  /* ---- přepínání stavů karty ---- */
  function hideFormChrome() {
    panels.forEach(function (p) { p.hidden = true; });
    if (railEl) railEl.hidden = true;
    if (metaEl) metaEl.hidden = true;
    navEl.hidden = true;
    setAlert('');
  }
  var submitted = {};                  // kategorie poslední odeslané poptávky (pro analytiku)
  function showDone() {
    hideFormChrome();
    errorEl.hidden = true;
    doneEl.hidden = false;
    doneEl.focus({ preventScroll: true });
    keepInView();
    clearSaved();                      // odesláno → rozepsaná kopie už není potřeba

    /* JEDINÉ místo, kde vzniká konverze. Sem se doteče jen po success:true
       od Web3Forms. Posílají se pouze kategorie z přepínačů — žádné jméno,
       telefon, e-mail, město, PSČ ani volný text. submission_id je náhodné
       UUID (crypto.randomUUID) a slouží k pozdějšímu spojení s poptávkou
       v CRM; sám o sobě nikoho neidentifikuje. */
    var props = ctxProps();
    props.service = normalize(SERVICE_KEYS, submitted.sluzba) || props.service;
    props.building_type = normalize(BUILDING_KEYS, submitted.objekt);
    props.situation = normalize(SITUATION_KEYS, submitted.situace);
    props.submission_id = submitted.submissionId;
    track('inquiry_submitted', props);
    clearCtx();                        // pokus skončil → kontext vstupu pryč
  }
  function showError(reason) {
    hideFormChrome();
    doneEl.hidden = true;
    errorEl.hidden = false;
    errorEl.focus({ preventScroll: true });
    keepInView();
    // Data zůstávají ve formuláři i v sessionStorage — „Zkusit znovu" je vrátí.
    track('inquiry_failed', { reason: failReason(reason) });
  }
  function resetSubmitBtn() {
    form.removeAttribute('aria-busy');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Odeslat nezávaznou poptávku';
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      errorEl.hidden = true;
      if (railEl) railEl.hidden = false;
      if (metaEl) metaEl.hidden = false;
      navEl.hidden = false;
      resetSubmitBtn();
      go(TOTAL);                       // zpět na kontaktní krok, odpovědi zůstaly
    });
  }

  /* ---- odeslání ---- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate(TOTAL)) return;
    if (doc.getElementById('f-web').value) return;      // honeypot — robot

    var data = collect();
    data.submissionId = newSubmissionId();
    /* Tady se ZÁMĚRNĚ nic neměří. Kliknutí na odeslat není konverze:
       může selhat síť, Web3Forms i konfigurace klíče. Konverzi hlásí až
       showDone(), tedy po success:true. */

    /* Chybějící klíč = špatná konfigurace, ne chyba uživatele. Nic se neodesílá
       a hlavně se nepředstírá úspěch — jinak by se poptávky tiše ztrácely. */
    if (!WEB3FORMS_ACCESS_KEY) {
      if (window.console && console.warn) {
        console.warn('[poptávka] Chybí WEB3FORMS_ACCESS_KEY v js/form.js — formulář nic neodeslal.');
      }
      showError('missing_config');
      return;
    }

    form.setAttribute('aria-busy', 'true');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Odesíláme…';

    var ac = new AbortController();
    var timedOut = false;
    var timer = window.setTimeout(function () { timedOut = true; ac.abort(); }, SUBMIT_TIMEOUT_MS);

    fetch(WEB3FORMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: ac.signal,
      body: JSON.stringify(payload(data))
    })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (j) {
        window.clearTimeout(timer);
        if (!j || !j.success) {
          /* Zpráva od Web3Forms se do analytiky úmyslně nedostane — jde jen
             kód. Pro ladění zůstává v konzoli. */
          if (j && j.message && window.console) console.warn('[poptávka] Web3Forms:', j.message);
          var rejected = new Error('provider_rejected');
          rejected.code = 'provider_rejected';
          throw rejected;
        }
        /* Poptávka je zachycená. Potvrzení zákazníkovi je až druhotné —
           posíláme ho na pozadí a na výsledek nečekáme. */
        sendConfirmation(data);
        submitted = data;
        showDone();
      })
      .catch(function (err) {
        window.clearTimeout(timer);
        resetSubmitBtn();
        showError(timedOut ? 'timeout' : ((err && err.code) || 'network_error'));
      });
  });

  /* ---- start ----
     Pořadí je důležité: nejdřív obnovit uložené odpovědi (včetně `branch`),
     teprve pak srovnat varianty kroku 3. Obráceně by se obnovená odpověď
     ze servisní větve zahodila, protože ta větev byla ještě disabled. */
  restore();
  syncBranch();
  if (telEl && telEl.value) telFormat(telDigits(telEl.value).length);
  if (pscEl && pscEl.value) pscFormat(pscDigits(pscEl.value).length);
  render(false);

  /* Kliknutí na CTA v kartě služby předvybere odpovídající službu. */
  Array.prototype.forEach.call(doc.querySelectorAll('[data-sluzba]'), function (a) {
    a.addEventListener('click', function () {
      var map = {
        'tepelne-cerpadlo': 'Tepelné čerpadlo', 'klimatizace': 'Klimatizace',
        'plynovy-kotel': 'Plynový kotel', 'servis': 'Servis nebo oprava'
      };
      var want = map[a.getAttribute('data-sluzba')];
      var input = form.querySelector('input[name="sluzba"][value="' + want + '"]');
      if (!input) return;
      input.checked = true;
      branch = input.getAttribute('data-next') || 'instalace';
      syncBranch();
      /* Klik na kartu je jen vstup do formuláře, ne zahájená poptávka —
         inquiry_started čeká na první opravdovou interakci. Kontext už
         uložil delegovaný posluchač výše. */
      go(2, false, true);
    });
  });
})();
