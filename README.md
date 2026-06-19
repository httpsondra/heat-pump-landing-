# Milan Dušek — landing page

Statická landing page (HTML + CSS + JS, GSAP z CDN) zaměřená na tepelná čerpadla,
klimatizace, plynové kotle a servis. Vizuálním těžištěm je hero, ve kterém se při
scrollování tepelné čerpadlo postupně rozkládá na součástky (scroll-scrub přes
obrázkovou sekvenci na canvasu, Apple styl). Na mobilu / při `prefers-reduced-motion`
se scrub vypne a místo něj běží lehké loop video, případně statický obrázek.

## Struktura

```
index.html              – celá stránka
css/styles.css          – design systém + responsivita + blend hero
js/main.js              – scrub, canvas renderer, reveal animace, fallback
scripts/build-assets.mjs – generování media assetů z jednoho videa (ffmpeg-static)
videos/heat-pump-exploded.mp4   – fallback video (generováno)
images/heat-pump-fallback.jpg   – statický fallback (generováno)
images/sequence/*.jpg + manifest.json – snímky pro scrub (generováno)
```

## Příprava assetů

Assety se generují **jednou** z videa `../Vaillant - tepelne cerpadlo video.mp4`
(o úroveň výš). Potřebuje Node.js — ffmpeg se stáhne automaticky přes `ffmpeg-static`,
nic dalšího instalovat netřeba.

```bash
npm install
npm run build
```

Vygeneruje re-encoded video (faststart), ~150 snímků sekvence (1280×720) a fallback
obrázek. Po vygenerování je web čistě statický — `node_modules/` a `scripts/` nejsou
pro běh potřeba a při nasazení je lze vynechat.

### Výměna videa

Stačí nahradit zdrojové `.mp4` o úroveň výš (nebo ho dát do `videos/source.mp4`)
a spustit `npm run build` znovu. Parametry (fps, šířka, kvalita) jsou nahoře v
`scripts/build-assets.mjs`.

## Lokální spuštění

Stránka používá absolutní cesty (`/css`, `/js`, `/images`, `/videos`), proto ji
spouštějte přes web server, ne otevřením souboru:

```bash
npm run serve          # http://localhost:4321
# nebo
npx serve .
```

## Kontakt (obsah stránky)

Milan Dušek · +420 603 479 240 · dusekmilan@volny.cz
Severovýchodní VI. 1525/29, 141 00 Praha 4 · IČO 67267092
