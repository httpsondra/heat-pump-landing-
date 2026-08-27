/* =========================================================================
   Formální oslovení zákazníka: „Dobrý den, pane Nováku,"
   -------------------------------------------------------------------------
   Skloňování příjmení je v češtině plné výjimek, takže se tu NIC neodhaduje
   podle sluchu. Používají se jen dvě věci:

     1) ověřená tabulka 5. pádů běžných mužských příjmení,
     2) dvě pravidla, která v češtině výjimku nemají:
          · přídavná jména (-ý / -í) mají 5. pád shodný s 1. (pane Novotný),
          · ženská příjmení na -ová / -á se neskloňují (paní Nováková).

   Rod se určuje ze jména, ne z odhadu: buď příjmení končí na -ová/-á,
   nebo je křestní jméno v mužské/ženské tabulce. Když si nejsme jistí
   čímkoli z toho, vrátí se obecné „Dobrý den,".

   Špatné oslovení je horší než žádné — proto je fallback tak častý.
   ========================================================================= */

/* Křestní jména slouží jen k určení rodu. */
const MALE_FIRST = new Set([
  'jan','petr','josef','pavel','jiří','martin','tomáš','jaroslav','miroslav',
  'zdeněk','václav','františek','milan','michal','lukáš','karel','david','jakub',
  'ondřej','marek','vladimír','roman','radek','daniel','filip','adam','stanislav',
  'ladislav','antonín','aleš','vojtěch','matěj','patrik','dominik','robert',
  'richard','libor','luboš','miloš','rostislav','bohumil','oldřich','vlastimil',
  'emil','ivan','igor','erik','šimon','štěpán','kryštof','tobiáš','matyáš',
  'viktor','denis','kamil','norbert','přemysl','bohuslav','vít','hynek',
  'jindřich','bedřich','alois','arnošt','otakar','svatopluk','radim','radovan',
  'zbyněk','břetislav','dalibor','leoš','lubomír','jaromír','otto','hugo',
  'šebestián','teodor','vilém','evžen','rudolf','gustav','alexandr','maxmilián'
]);

const FEMALE_FIRST = new Set([
  'jana','marie','eva','hana','anna','lenka','kateřina','věra','lucie','alena',
  'petra','jaroslava','martina','tereza','veronika','michaela','zuzana','monika',
  'ludmila','jitka','barbora','markéta','klára','šárka','ivana','dana','radka',
  'simona','denisa','nikola','adéla','andrea','kristýna','julie','natálie',
  'eliška','karolína','gabriela','daniela','pavla','blanka','helena','irena',
  'olga','vlasta','miroslava','milada','božena','emilie','alžběta','sofie',
  'viktorie','anežka','magdaléna','renata','romana','iveta','jarmila','květa',
  'libuše','bohumila','stanislava','zdeňka','vendula','aneta','kamila','nela',
  'ema','sára','laura','amálie','rozálie','štěpánka','vladimíra','michala',
  'alexandra','dagmar','ingrid'
]);

/* 5. pád mužských příjmení — ověřené tvary. Nepřidávat nic „podle citu";
   co tu není, dostane obecné oslovení, a to je v pořádku.
   Záměrně vynechána příjmení na -ec (Kadlec, Švec, Moravec) kromě Němec
   a cizí příjmení bez ustáleného českého 5. pádu (např. Nguyen). */
const SURNAME_VOCATIVE = {
  'novák':'Nováku','svoboda':'Svobodo','dvořák':'Dvořáku','procházka':'Procházko',
  'kučera':'Kučero','horák':'Horáku','němec':'Němče','marek':'Marku',
  'pospíšil':'Pospíšile','hájek':'Hájku','jelínek':'Jelínku','král':'Králi',
  'růžička':'Růžičko','beneš':'Beneši','fiala':'Fialo','sedláček':'Sedláčku',
  'doležal':'Doležale','zeman':'Zemane','kolář':'Koláři','navrátil':'Navrátile',
  'čermák':'Čermáku','vaněk':'Vaňku','urban':'Urbane','blažek':'Blažku',
  'kříž':'Kříži','kovář':'Kováři','bartoš':'Bartoši','vlček':'Vlčku',
  'polák':'Poláku','musil':'Musile','štěpánek':'Štěpánku','holub':'Holube',
  'mareš':'Mareši','vávra':'Vávro','kratochvíl':'Kratochvíle','dušek':'Dušku',
  'bednář':'Bednáři','sýkora':'Sýkoro','šimek':'Šimku','havlíček':'Havlíčku',
  'matoušek':'Matoušku','soukup':'Soukupe','beran':'Berane','šmíd':'Šmíde',
  'liška':'Liško','kubíček':'Kubíčku','dostál':'Dostále','bláha':'Bláho',
  'pavlík':'Pavlíku','kohout':'Kohoute','vlk':'Vlku','šebesta':'Šebesto',
  'richter':'Richtere','vondra':'Vondro','adam':'Adame','barták':'Bartáku',
  'bureš':'Bureši','čech':'Čechu','doubek':'Doubku','drábek':'Drábku',
  'duda':'Dudo','fišer':'Fišere','hanuš':'Hanuši','hruška':'Hruško',
  'janda':'Jando','janeček':'Janečku','kašpar':'Kašpare','klíma':'Klímo',
  'kubát':'Kubáte','lang':'Langu','mach':'Machu','nedvěd':'Nedvěde',
  'novosad':'Novosade','pekař':'Pekaři','petr':'Petře','pilař':'Pilaři',
  'plíšek':'Plíšku','pražák':'Pražáku','prokop':'Prokope','rybář':'Rybáři',
  'říha':'Řího','sedlák':'Sedláku','sokol':'Sokole','straka':'Strako',
  'šebek':'Šebku','šimon':'Šimone','škoda':'Škodo','šmejkal':'Šmejkale',
  'špaček':'Špačku','štefan':'Štefane','tesař':'Tesaři','tomek':'Tomku',
  'turek':'Turku','vacek':'Vacku','valenta':'Valento','vaníček':'Vaníčku',
  'vejvoda':'Vejvodo','zahradník':'Zahradníku','zíka':'Zíko','žák':'Žáku'
};

/* Náznaky, že nejde o jméno člověka. */
const COMPANY = /(\bs\.?\s?r\.?\s?o\b|\ba\.?\s?s\b|\bspol\b|\bz\.?ú\b|\bo\.?p\.?s\b|\bltd\b|\binc\b|\bgmbh\b|\bfirma\b|\bservis\b|@|&|\/|\bwww\b|http)/i;
const LETTERS = /^[a-zA-ZáčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]+$/;

/* Akademické tituly na začátku — zahodíme je, jméno je až za nimi. */
const TITLES = new Set([
  'ing','mgr','bc','mudr','judr','phdr','rndr','paeddr','mvdr','doc','prof',
  'dr','ph.d','th.d','dis','pan','paní'
]);

function words(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.replace(/^[.,;:!?"'()[\]]+|[.,;:!?"'()[\]]+$/g, ''))
    .filter(w => w && !TITLES.has(w.toLowerCase().replace(/\.$/, '')));
}

/* Přídavné mužské příjmení (Novotný, Krejčí) — 5. pád = 1. pád. */
function isAdjectivalMale(s) {
  return /(ý|í)$/.test(s);
}
/* Ženské příjmení (Nováková, Novotná) — 5. pád = 1. pád. */
function isFemaleSurname(s) {
  return /(ová|á)$/.test(s);
}

/**
 * Formální oslovení, nebo '' když si nejsme jistí.
 * Vyžaduje jméno i příjmení — z jednoho slova nepoznáme, co je co.
 */
export function formalGreetingName(raw) {
  if (!raw) return '';
  const value = String(raw).replace(/\s+/g, ' ').trim();
  if (!value || /\d/.test(value) || COMPANY.test(value)) return '';

  const parts = words(value);
  if (parts.length < 2) return '';                 // jen jedno slovo → nevíme

  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!LETTERS.test(first) || !LETTERS.test(last)) return '';
  if (last.length < 2 || last.length > 24) return '';

  const firstLc = first.toLowerCase();
  const lastLc = last.toLowerCase();

  /* --- žena --- */
  const femaleBySurname = isFemaleSurname(last);
  const femaleByFirst = FEMALE_FIRST.has(firstLc);
  if (femaleBySurname || femaleByFirst) {
    // Oslovíme jen tvarem, který se nemění. Jinak radši obecně.
    if (!femaleBySurname) return '';
    return 'paní ' + last;
  }

  /* --- muž --- */
  const maleByFirst = MALE_FIRST.has(firstLc);
  if (!maleByFirst && !isAdjectivalMale(last)) return '';   // rod neznámý

  if (isAdjectivalMale(last)) return 'pane ' + last;        // Novotný → Novotný
  const voc = SURNAME_VOCATIVE[lastLc];
  return voc ? 'pane ' + voc : '';
}

/** Celý první řádek e-mailu. */
export function greeting(raw) {
  const name = formalGreetingName(raw);
  return name ? `Dobrý den, ${name},` : 'Dobrý den,';
}
