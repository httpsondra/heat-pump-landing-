/* =========================================================================
   IndexNow — ohlášení změněných URL vyhledávačům (Bing, Seznam, Yandex…)

   Proč skript a ne automatika: web je statický, nasazuje se přes git push
   a indexovatelná URL je zatím jediná — úvodní stránka. Cron ani hook by
   tu jen posílaly tutéž adresu dokola. Protokol výslovně říká, že se mají
   hlásit jen SKUTEČNĚ ZMĚNĚNÉ adresy; opakované zbytečné odesílání je
   důvod k omezení.

   Spouští se ručně po nasazení obsahové změny:
       npm run indexnow

   Klíč není tajemství. IndexNow ho ověřuje tak, že si stáhne
   https://www.md-therm.cz/<klíč>.txt a porovná obsah — soubor tedy MUSÍ
   zůstat veřejně dostupný a nasazený. Když se smaže, odesílání přestane
   fungovat (server vrátí 403).

   Google IndexNow nepoužívá; ten se řídí sitemapou a vlastním procházením.
   ========================================================================= */
const HOST = 'www.md-therm.cz';
const KEY = 'd179bb59726836566b0db0a2dfb4e934';
const URLS = ['https://www.md-therm.cz/'];   // jen veřejné, indexovatelné adresy

const body = {
  host: HOST,
  key: KEY,
  keyLocation: `https://${HOST}/${KEY}.txt`,
  urlList: URLS,
};

/* Nejdřív ověřit, že klíč je opravdu venku. Bez toho by odeslání skončilo
   403 a nebylo by poznat, jestli je chyba v klíči, nebo v nasazení. */
const check = await fetch(body.keyLocation);
if (!check.ok) {
  console.error(`Klíč není dostupný na ${body.keyLocation} (HTTP ${check.status}).`);
  console.error('Soubor s klíčem musí být nasazený, jinak IndexNow odesílání odmítne.');
  process.exit(1);
}
if ((await check.text()).trim() !== KEY) {
  console.error('Soubor s klíčem existuje, ale jeho obsah neodpovídá klíči ve skriptu.');
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

/* 200 = přijato, 202 = přijato a klíč se teprve ověřuje. Obojí je v pořádku. */
if (res.status === 200 || res.status === 202) {
  console.log(`IndexNow: ${res.status} — ohlášeno ${URLS.length} URL`);
} else {
  console.error(`IndexNow selhal: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
