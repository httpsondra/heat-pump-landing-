/* Ověřené 5. pády běžných českých křestních jmen.
   Záměrně se nic neodvozuje — co není v tabulce, dostane obecné „Dobrý den,".
   Zdroj pravdy je stejná tabulka jako v ../../emails/vocative.json. */
export const VOCATIVE = {
  // mužská
  'jan':'Jane','petr':'Petře','josef':'Josefe','pavel':'Pavle','jiří':'Jiří',
  'martin':'Martine','tomáš':'Tomáši','jaroslav':'Jaroslave','miroslav':'Miroslave',
  'zdeněk':'Zdeňku','václav':'Václave','františek':'Františku','milan':'Milane',
  'michal':'Michale','lukáš':'Lukáši','karel':'Karle','david':'Davide','jakub':'Jakube',
  'ondřej':'Ondřeji','marek':'Marku','vladimír':'Vladimíre','roman':'Romane',
  'radek':'Radku','daniel':'Danieli','filip':'Filipe','adam':'Adame',
  'stanislav':'Stanislave','ladislav':'Ladislave','antonín':'Antoníne','aleš':'Aleši',
  'vojtěch':'Vojtěchu','matěj':'Matěji','patrik':'Patriku','dominik':'Dominiku',
  'robert':'Roberte','richard':'Richarde','libor':'Libore','luboš':'Luboši',
  'miloš':'Miloši','rostislav':'Rostislave','bohumil':'Bohumile','oldřich':'Oldřichu',
  'vlastimil':'Vlastimile','emil':'Emile','ivan':'Ivane','igor':'Igore','erik':'Eriku',
  'šimon':'Šimone','štěpán':'Štěpáne','kryštof':'Kryštofe','tobiáš':'Tobiáši',
  'matyáš':'Matyáši','viktor':'Viktore','denis':'Denisi','kamil':'Kamile',
  'norbert':'Norberte','přemysl':'Přemysle','bohuslav':'Bohuslave','vít':'Víte',
  'hynek':'Hynku','jindřich':'Jindřichu','bedřich':'Bedřichu','alois':'Aloisi',
  'arnošt':'Arnošte','otakar':'Otakare','svatopluk':'Svatopluku','radim':'Radime',
  'radovan':'Radovane','zbyněk':'Zbyňku','břetislav':'Břetislave','dalibor':'Dalibore',
  'leoš':'Leoši','lubomír':'Lubomíre','jaromír':'Jaromíre','otto':'Otto','hugo':'Hugo',
  'šebestián':'Šebestiáne','teodor':'Teodore','vilém':'Viléme','evžen':'Evžene',
  'rudolf':'Rudolfe','gustav':'Gustave','alexandr':'Alexandře','maxmilián':'Maxmiliáne',
  // ženská
  'jana':'Jano','marie':'Marie','eva':'Evo','hana':'Hano','anna':'Anno','lenka':'Lenko',
  'kateřina':'Kateřino','věra':'Věro','lucie':'Lucie','alena':'Aleno','petra':'Petro',
  'jaroslava':'Jaroslavo','martina':'Martino','tereza':'Terezo','veronika':'Veroniko',
  'michaela':'Michaelo','zuzana':'Zuzano','monika':'Moniko','ludmila':'Ludmilo',
  'jitka':'Jitko','barbora':'Barboro','markéta':'Markéto','klára':'Kláro','šárka':'Šárko',
  'ivana':'Ivano','dana':'Dano','radka':'Radko','simona':'Simono','denisa':'Deniso',
  'nikola':'Nikolo','adéla':'Adélo','andrea':'Andreo','kristýna':'Kristýno',
  'julie':'Julie','natálie':'Natálie','eliška':'Eliško','karolína':'Karolíno',
  'gabriela':'Gabrielo','daniela':'Danielo','pavla':'Pavlo','blanka':'Blanko',
  'helena':'Heleno','irena':'Ireno','olga':'Olgo','vlasta':'Vlasto',
  'miroslava':'Miroslavo','milada':'Milado','božena':'Boženo','emilie':'Emilie',
  'alžběta':'Alžběto','sofie':'Sofie','viktorie':'Viktorie','anežka':'Anežko',
  'magdaléna':'Magdaléno','renata':'Renato','romana':'Romano','iveta':'Iveto',
  'jarmila':'Jarmilo','květa':'Květo','libuše':'Libuše','bohumila':'Bohumilo',
  'stanislava':'Stanislavo','zdeňka':'Zdeňko','vendula':'Vendulo','aneta':'Aneto',
  'kamila':'Kamilo','nela':'Nelo','ema':'Emo','sára':'Sáro','laura':'Lauro',
  'amálie':'Amálie','rozálie':'Rozálie','štěpánka':'Štěpánko','vladimíra':'Vladimíro',
  'michala':'Michalo','alexandra':'Alexandro','dagmar':'Dagmar','ingrid':'Ingrid'
};

// Náznaky, že jde o firmu nebo kontaktní údaj, ne o jméno člověka.
const COMPANY = /(\bs\.?\s?r\.?\s?o\b|\ba\.?\s?s\b|\bspol\b|\bz\.?ú\b|\bo\.?p\.?s\b|\bltd\b|\binc\b|\bgmbh\b|\bfirma\b|\bservis\b|@|&|\/|\bwww\b|http)/i;
const LETTERS = /^[a-zA-ZáčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]+$/;

/** Vrátí 5. pád křestního jména, nebo '' když si nejsme jistí. */
export function firstNameVocative(raw) {
  if (!raw) return '';
  const value = String(raw).replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (/\d/.test(value)) return '';
  if (COMPANY.test(value)) return '';

  const token = value.split(' ')[0].replace(/^[.,;:!?"'()[\]]+|[.,;:!?"'()[\]]+$/g, '');
  if (token.length < 2 || token.length > 20) return '';
  if (!LETTERS.test(token)) return '';

  return VOCATIVE[token.toLowerCase()] || '';
}

/** Celý první řádek e-mailu. */
export function greeting(raw) {
  const v = firstNameVocative(raw);
  return v ? `Dobrý den, ${v},` : 'Dobrý den,';
}
