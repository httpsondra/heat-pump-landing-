/* =========================================================================
   Milan Dušek — poptávkový formulář, FAQ a mobilní lišta
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

  /* ---- drobný pomocník pro analytiku (PostHog se načítá později) ---- */
  function track(name, props) {
    try { if (window.posthog && window.posthog.capture) window.posthog.capture(name, props || {}); }
    catch (e) { /* analytika nikdy nesmí shodit formulář */ }
  }

  /* =======================================================================
     ODESLÁNÍ POPTÁVKY — konfigurace
     -----------------------------------------------------------------------
     Web zatím nemá žádný backend ani e-mailovou službu.

     JAK TO FUNGUJE TEĎ (bez nastavení):
       Formulář sesbírá odpovědi a otevře uživateli jeho e-mailového klienta
       s předvyplněnou, čitelně naformátovanou poptávkou. Uživatel ji jen
       odešle. Funguje to okamžitě a nic se neztrácí "do prázdna" — ale část
       lidí ten poslední krok neudělá.

     JAK TO ZAPNOUT NAPLNO (doporučeno, ~5 minut):
       1) Založit zdarma účet na https://web3forms.com a nechat si poslat
          access key na dusekmilan@volny.cz.
       2) Vložit ten klíč níže do ACCESS_KEY.
       3) Hotovo — poptávka pak chodí Milanovi rovnou na e-mail, uživatel
          vidí potvrzení na stránce a nic nemusí odesílat ručně.
       CSP už api.web3forms.com povoluje (viz connect-src ve vercel.json),
       takže se nic dalšího měnit nemusí.

     Dokud je ACCESS_KEY prázdný, na server se záměrně NEPOSÍLÁ nic —
     žádný zbytečný požadavek, žádné falešné "odesláno".
     ======================================================================= */
  var ENDPOINT   = 'https://api.web3forms.com/submit';
  var ACCESS_KEY = '';                 // TODO (Milan): sem vložit klíč z web3forms.com
  var MAIL_TO    = 'dusekmilan@volny.cz';
  var PHONE      = '+420 603 479 240';

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
        track('faq_open', { question: btn.textContent.trim().slice(0, 80) });
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
  var microEl  = doc.getElementById('inquiryMicro');
  var alertEl  = doc.getElementById('inquiryAlert');
  var doneEl   = doc.getElementById('inquiryDone');
  var doneText = doc.getElementById('inquiryDoneText');
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
      if (psc && !/^\d{3}\s?\d{2}$/.test(psc)) { fieldError('psc', 'PSČ zadejte prosím jako pět číslic, např. 141 00.'); ok = false; }
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
      if (!tel) { fieldError('telefon', 'Doplňte prosím telefon, ať se vám mám kam ozvat.'); ok2 = false; }
      else if (!/^\+?[\d\s()/-]{9,17}$/.test(tel)) { fieldError('telefon', 'Zkontrolujte prosím tvar telefonního čísla.'); ok2 = false; }
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { fieldError('email', 'Zkontrolujte prosím tvar e-mailu.'); ok2 = false; }
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
    microEl.hidden = !last;
    // Krok 5 je celý nepovinný — ať je vidět, že se dá přeskočit.
    nextBtn.textContent = step === 5 ? 'Přeskočit a pokračovat' : 'Pokračovat';
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

  function go(n, focusIt) {
    step = Math.min(TOTAL, Math.max(1, n));
    setAlert('');
    render(focusIt !== false);
    track('inquiry_step', { step: step, label: LABELS[step - 1] });
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
    if (!started) { started = true; track('inquiry_start', {}); }
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
    if (!started) { started = true; track('inquiry_start', {}); }
    save();
  });

  // Enter v textovém poli posune na další krok místo odeslání formuláře
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target.tagName === 'TEXTAREA') return;
    if (step < TOTAL) { e.preventDefault(); if (validate(step)) go(step + 1); }
  });

  /* ---- sestavení čitelné poptávky ---- */
  function collect() {
    function val(id) { var el = doc.getElementById('f-' + id); return el ? el.value.trim() : ''; }
    function radio(n) { var el = form.querySelector('input[name="' + n + '"]:checked'); return el ? el.value : ''; }
    return {
      sluzba: radio('sluzba'), objekt: radio('objekt'), situace: radio('situace'),
      mesto: val('mesto'), psc: val('psc'), popis: val('popis'), zarizeni: val('zarizeni'),
      jmeno: val('jmeno'), telefon: val('telefon'), email: val('email')
    };
  }
  function asText(d) {
    return [
      'Nová poptávka z webu dusekweb.com', '',
      'Služba:    ' + (d.sluzba || '—'),
      'Objekt:    ' + (d.objekt || '—'),
      'Situace:   ' + (d.situace || '—'),
      'Místo:     ' + (d.mesto || '—') + (d.psc ? ', ' + d.psc : ''),
      'Zařízení:  ' + (d.zarizeni || '—'), '',
      'Popis:', (d.popis || '—'), '',
      '— Kontakt —',
      'Jméno:     ' + d.jmeno,
      'Telefon:   ' + d.telefon,
      'E-mail:    ' + (d.email || '—')
    ].join('\n');
  }

  function showDone(msg) {
    panels.forEach(function (p) { p.hidden = true; });
    if (railEl) railEl.hidden = true;
    if (metaEl) metaEl.hidden = true;
    navEl.hidden = true;
    microEl.hidden = true;
    setAlert('');
    if (msg) doneText.textContent = msg;
    doneEl.hidden = false;
    doneEl.focus({ preventScroll: true });
    keepInView();
    clearSaved();
  }

  /* ---- odeslání ---- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate(TOTAL)) return;
    if (doc.getElementById('f-web').value) return;      // honeypot — robot

    var data = collect();
    track('inquiry_submit', { sluzba: data.sluzba, objekt: data.objekt, mesto: data.mesto });

    // Bez nastaveného klíče se na server nic neposílá — otevře se předvyplněný
    // e-mail. Žádný zbytečný požadavek a hlavně žádné falešné „odesláno".
    if (!ACCESS_KEY) { handoffToMail(data); return; }

    form.setAttribute('aria-busy', 'true');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Odesílám…';

    var ac = new AbortController();
    var timer = window.setTimeout(function () { ac.abort(); }, 12000);

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        access_key: ACCESS_KEY,
        subject: 'Nová poptávka z webu — ' + (data.sluzba || 'neurčeno'),
        from_name: 'Web Milan Dušek',
        replyto: data.email || undefined,
        message: asText(data)
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.success) throw new Error(j && j.message || 'odeslání selhalo');
        window.clearTimeout(timer);
        showDone('Díky, mám ji. Ozvu se vám na uvedený kontakt a probereme detaily.');
      })
      .catch(function () {
        window.clearTimeout(timer);
        form.removeAttribute('aria-busy');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Odeslat nezávaznou poptávku';
        // Lead se nesmí ztratit — nabídneme e-mail i telefon.
        setAlert('Poptávku se nepodařilo odeslat. Zkuste to prosím znovu, nebo zavolejte na +420 603 479 240.');
        handoffToMail(data, true);
      });
  });

  /* Předvyplněný e-mail — funguje bez jakéhokoli backendu. */
  function handoffToMail(data, afterError) {
    var href = 'mailto:' + MAIL_TO +
      '?subject=' + encodeURIComponent('Poptávka z webu — ' + (data.sluzba || 'neurčeno')) +
      '&body=' + encodeURIComponent(asText(data));
    try { window.location.href = href; } catch (e) {}
    if (afterError) return;
    showDone('Otevřel jsem vám e-mail s vyplněnou poptávkou — stačí ji odeslat. ' +
             'Pokud se e-mail neotevřel, zavolejte prosím na ' + PHONE + '.');
  }

  /* ---- start ----
     Pořadí je důležité: nejdřív obnovit uložené odpovědi (včetně `branch`),
     teprve pak srovnat varianty kroku 3. Obráceně by se obnovená odpověď
     ze servisní větve zahodila, protože ta větev byla ještě disabled. */
  restore();
  syncBranch();
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
      if (!started) { started = true; track('inquiry_start', { from: 'service_card' }); }
      go(2, false);
    });
  });
})();
