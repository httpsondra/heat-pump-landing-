/* =========================================================================
   Milan Dušek — landing page
   - sticky bar stav
   - reveal animace (IntersectionObserver)
   - scroll-scrub tepelného čerpadla (obrázková sekvence na canvasu + GSAP)
   - fallback pro mobil / reduced-motion (autoplay loop video)
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;
  var html = doc.documentElement;

  /* ---- rok v patičce ---- */
  var yearEl = doc.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---- sticky topbar stav ---- */
  var topbar = doc.getElementById('topbar');
  function onScrollTop() {
    if (!topbar) return;
    topbar.classList.toggle('is-stuck', window.scrollY > 8);
  }
  onScrollTop();
  window.addEventListener('scroll', onScrollTop, { passive: true });

  /* ---- mobile menu toggle ---- */
  var menuToggle = doc.getElementById('menuToggle');
  var topnav = doc.querySelector('.topnav');
  if (menuToggle && topnav) {
    menuToggle.addEventListener('click', function () {
      var isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
      menuToggle.setAttribute('aria-expanded', !isOpen);
      topnav.classList.toggle('is-open', !isOpen);
    });
    // Close menu on nav link click
    var navLinks = topnav.querySelectorAll('a');
    navLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        menuToggle.setAttribute('aria-expanded', 'false');
        topnav.classList.remove('is-open');
      });
    });
  }

  /* ---- reveal animace ---- */
  var revealEls = Array.prototype.slice.call(doc.querySelectorAll('.reveal'));
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (revealEls.length) {
    if (prefersReduced || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      // Mobile-friendly: reduce aggressive bottom margin on small viewports
      var isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
      var rootMargin = isSmallScreen ? '0px 0px -5% 0px' : '0px 0px -10% 0px';
      var threshold = isSmallScreen ? 0.08 : 0.12;

      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
        });
      }, { rootMargin: rootMargin, threshold: threshold });
      revealEls.forEach(function (el) { io.observe(el); });
    }
  }

  /* ---- karty služeb: reflektor sledující kurzor ---- */
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var cards = Array.prototype.slice.call(doc.querySelectorAll('.card'));
    cards.forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ---- scrollspy: aktivní záložka podle pozice scrollu ---- */
  var spyLinks = Array.prototype.slice.call(doc.querySelectorAll('.topnav a[href^="#"]'));
  var spyMap = {};
  var spySections = [];
  spyLinks.forEach(function (link) {
    var id = link.getAttribute('href').slice(1);
    var sec = doc.getElementById(id);
    if (sec) { spyMap[id] = link; spySections.push(sec); }
  });
  if (spySections.length) {
    var spyOffset = 140;          // referenční linka pod sticky lištou
    var activeSpyId = null;
    var indicator = doc.querySelector('.topnav__indicator');
    var moveIndicator = function (link) {
      if (!indicator) return;
      if (link && link.offsetWidth) {
        indicator.style.width = link.offsetWidth + 'px';
        indicator.style.transform = 'translateX(' + link.offsetLeft + 'px)';
        indicator.style.opacity = '1';
      } else {
        indicator.style.opacity = '0';
      }
    };
    var setActive = function (id) {
      if (id === activeSpyId) return;
      activeSpyId = id;
      spyLinks.forEach(function (l) { l.classList.remove('is-active'); l.removeAttribute('aria-current'); });
      var link = id && spyMap[id];
      if (link) { link.classList.add('is-active'); link.setAttribute('aria-current', 'true'); }
      moveIndicator(link);
    };
    var updateSpy = function () {
      var currentId = null;
      for (var i = 0; i < spySections.length; i++) {
        if (spySections[i].getBoundingClientRect().top <= spyOffset) currentId = spySections[i].id;
      }
      setActive(currentId);
    };
    window.addEventListener('scroll', updateSpy, { passive: true });
    // Po změně šířky okna přesuň indikátor pod aktivní záložku bez animace
    window.addEventListener('resize', function () {
      var link = activeSpyId && spyMap[activeSpyId];
      if (!indicator || !link) return;
      var prev = indicator.style.transition;
      indicator.style.transition = 'none';
      moveIndicator(link);
      void indicator.offsetWidth;          // vynucený reflow
      indicator.style.transition = prev;
    }, { passive: true });
    updateSpy();
  }

  /* =======================================================================
     HERO – scroll-scrub vs fallback
     ======================================================================= */
  var canvas = doc.getElementById('heroCanvas');
  var loader = doc.getElementById('heroLoader');
  var fallback = doc.getElementById('heroFallback');
  var heroStage = doc.getElementById('heroStage');
  var heroCopy = doc.getElementById('heroCopy');
  var heroHint = doc.getElementById('heroHint');
  var heroLines = Array.prototype.slice.call(doc.querySelectorAll('.hero__title .hero__line'));
  var annoBox = doc.getElementById('annotations');
  var annoEls = Array.prototype.slice.call(doc.querySelectorAll('.anno'));

  var smallScreen = window.matchMedia('(max-width: 860px)').matches;
  var gsapReady = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  // Fallback režim: bez canvas scrubu, místo toho autoplay/loop video
  function enterFallbackMode() {
    html.classList.add('no-scrub');
    if (fallback) {
      fallback.setAttribute('preload', 'auto');
      // autoplay až po interakci/načtení; muted+playsinline je v markupu
      var tryPlay = function () {
        var p = fallback.play();
        if (p && typeof p.catch === 'function') p.catch(function () {/* uživatel spustí sám */});
      };
      if (fallback.readyState >= 2) tryPlay();
      else fallback.addEventListener('loadeddata', tryPlay, { once: true });
      fallback.load();
    }
  }

  if (!canvas || prefersReduced || smallScreen || !gsapReady) {
    enterFallbackMode();
    return;
  }

  /* ---------- Image sequence scrub (desktop) ---------- */
  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var frames = [];
  var total = 0;
  var current = 0;
  var ready = false;

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  }

  function nearestLoaded(i) {
    var img = frames[i];
    if (img && img.complete && img.naturalWidth > 0) return img;
    for (var d = 1; d < total; d++) {
      var a = frames[i - d], b = frames[i + d];
      if (a && a.complete && a.naturalWidth > 0) return a;
      if (b && b.complete && b.naturalWidth > 0) return b;
    }
    return null;
  }

  var RATIO = 16 / 9;        // poměr snímků (1280×720)

  function resizeCanvas() {
    var box = canvas.parentElement.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // Width-constrained to the right column — natural 16:9, product with breathing room.
    var w = Math.min(box.width, window.innerWidth * 0.95, 1680);
    var h = w / RATIO;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = Math.round(w) + 'px';
    canvas.style.height = Math.round(h) + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (annoBox) { annoBox.style.width = Math.round(w) + 'px'; annoBox.style.height = Math.round(h) + 'px'; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawFrame(current);
  }

  function drawFrame(i) {
    var img = nearestLoaded(i);
    if (!img) return;
    current = i;
    var cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    // cover – canvas má stejný poměr jako snímek, takže vyplní beze zbytku
    var ir = img.naturalWidth / img.naturalHeight;
    var cr = cw / ch;
    var dw, dh;
    if (cr > ir) { dw = cw; dh = cw / ir; } else { dh = ch; dw = ch * ir; }
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  function setupScrollTrigger() {
    if (ready) return;
    ready = true;
    window.gsap.registerPlugin(window.ScrollTrigger);

    window.ScrollTrigger.create({
      trigger: '.hero',
      start: 'top top',
      end: function () { return '+=' + Math.round(window.innerHeight * 3.2); },
      pin: '.hero__stage',
      pinSpacing: true,
      scrub: 1,                 /* delší doběh = plynulejší glide, míň „skákání" snímků */
      anticipatePin: 1,         /* hladší zapnutí/uvolnění pinu (konec animace) */
      invalidateOnRefresh: true,
      onUpdate: function (self) {
        var p = self.progress;
        var idx = Math.min(total - 1, Math.max(0, Math.round(p * (total - 1))));
        if (idx !== current) drawFrame(idx);

        // kinematické vrstvy (tepelný nádech + vinětace) reagují na postup scrollu
        if (heroStage) heroStage.style.setProperty('--hero-p', p.toFixed(4));

        // po načtení (p<initHold) je nadpis plně černý; pak zbledne a „reflektor" se posouvá po řádcích
        if (heroLines.length) {
          var nLines = heroLines.length;
          var initHold = 0.05, hlStart = 0.12, hlEnd = 0.66;
          var allInk = p < initHold;
          var active = -1;
          if (!allInk && p >= hlStart) {
            var seg = (hlEnd - hlStart) / nLines;
            active = Math.min(nLines - 1, Math.floor((p - hlStart) / seg));
          }
          for (var hl = 0; hl < nLines; hl++) {
            var focus = (active === hl);
            heroLines[hl].classList.toggle('is-focus', focus);
            heroLines[hl].classList.toggle('is-pale', !focus && !allInk);
          }
        }

        // text zůstává čitelný, dokud se řádky rozsvěcují; teprve na konci pinu se jemně vytratí
        if (heroCopy) {
          var exit = Math.max(0, Math.min(1, (p - 0.78) / 0.22));
          heroCopy.style.opacity = (1 - exit).toFixed(3);
          heroCopy.style.transform = 'translate(-50%, calc(-50% - ' + (34 * exit).toFixed(1) + 'px))';
        }
        if (heroHint) heroHint.style.opacity = p > 0.04 ? '0' : '1';

        // canvas + anotace zůstávají vycentrované, produkt se jemně přiblíží (bez posunu do strany)
        if (canvas) {
          var sc = 1 + 0.06 * Math.min(p / 0.6, 1);
          var t = 'translate(-50%, -50%) scale(' + sc.toFixed(4) + ')';
          canvas.style.transform = t;
          if (annoBox) annoBox.style.transform = t;
        }

        // anotace součástek
        for (var k = 0; k < annoEls.length; k++) {
          var at = parseFloat(annoEls[k].getAttribute('data-at')) || 1;
          annoEls[k].classList.toggle('is-on', p >= at && p < 0.99);
        }
      }
    });

    window.ScrollTrigger.refresh();
  }

  // Načtení manifestu a přednačtení snímků
  fetch('/images/sequence/manifest.json', { cache: 'force-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('manifest ' + r.status);
      return r.json();
    })
    .then(function (m) {
      total = m.count;
      var padLen = m.pad || 4;
      var loadedCount = 0;
      var firstDrawn = false;

      function frameSrc(i) { return '/images/sequence/heat-pump-' + pad(i + 1, padLen) + '.jpg'; }
      function onSettled() {
        loadedCount++;
        if (loadedCount >= total && window.ScrollTrigger) window.ScrollTrigger.refresh();
      }

      // 1) První snímek přednostně — odemkne hero a nastavení ScrollTriggeru co nejdřív.
      (function () {
        var img = new Image();
        img.decoding = 'async';
        if ('fetchPriority' in img) img.fetchPriority = 'high';
        img.onload = function () {
          onSettled();
          if (!firstDrawn) {
            firstDrawn = true;
            if (loader) loader.classList.add('is-hidden');
            resizeCanvas();
            setupScrollTrigger();
          }
        };
        img.onerror = onSettled;
        frames[0] = img;
        img.src = frameSrc(0);
      })();

      // 2) Zbytek snímků na pozadí — sekvenčně, s omezenou soubežností, spuštěno až
      //    když je stránka klidná. 150 snímků (~5,7 MB) jinak zahltí síť a brzdí
      //    první vykreslení; nearestLoaded() zvládne chybějící snímky během scrollu.
      var next = 1, inFlight = 0, MAX_PARALLEL = 6;
      function pump() {
        while (inFlight < MAX_PARALLEL && next < total) {
          var i = next++;
          inFlight++;
          (function (i) {
            var img = new Image();
            img.decoding = 'async';
            if ('fetchPriority' in img) img.fetchPriority = 'low';
            img.onload = function () { inFlight--; onSettled(); pump(); };
            img.onerror = function () { inFlight--; onSettled(); pump(); };
            frames[i] = img;
            img.src = frameSrc(i);
          })(i);
        }
      }
      // Spustit načítání hned. Snímky mají fetchPriority:'low', takže je prohlížeč
      // sám zařadí až za kritické zdroje (fonty, CSS, první snímek) — první
      // vykreslení tím netrpí. Dřívější odklad na requestIdleCallback způsobil, že
      // scrub „nescrolloval": snímky nebyly načtené, když uživatel hned zascrolloval.
      pump();

      // pojistka: kdyby se první snímek z cache načetl okamžitě
      window.setTimeout(function () {
        if (!firstDrawn && nearestLoaded(0)) {
          firstDrawn = true;
          if (loader) loader.classList.add('is-hidden');
          resizeCanvas();
          setupScrollTrigger();
        }
      }, 400);
    })
    .catch(function () {
      // Když cokoli selže, spadni elegantně do fallbacku
      enterFallbackMode();
    });

  /* ---- resize ---- */
  var rt;
  window.addEventListener('resize', function () {
    window.clearTimeout(rt);
    rt = window.setTimeout(function () {
      resizeCanvas();
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
    }, 160);
  });
})();
