/* =========================================================================
   Testy oslovení zákazníka („Dobrý den, pane Hrubeši,")
   -------------------------------------------------------------------------
   Oslovení je jediné místo e-mailu, kde se zákazníkovo jméno ohýbá. Špatný
   tvar je horší než žádný, takže se tu hlídají obě strany:

     · co systém umí, ať to nepřestane umět (tabulka + dvě pravidla),
     · co neumí, ať se ani nepokusí — obecné „Dobrý den," je správná odpověď.

   Zvlášť se hlídá, že se do e-mailu nikdy nedostane příjmení v 1. pádu
   („pane Hrubeš"). To je typická chyba, kterou by naivní zjednodušení
   („prostě přilep příjmení") zavedlo a testy výše by ji nechytily.
   ========================================================================= */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { greeting, formalGreetingName } from './_vocative.mjs';

describe('oslovení — muži z ověřené tabulky', () => {
  /* Dvojice: vstup z formuláře → očekávaný 5. pád. */
  const muzi = [
    ['Ondřej Hrubeš', 'Hrubeši'],   // regrese: do 2026-08-30 chybělo v tabulce
    ['Jan Novák', 'Nováku'],
    ['Petr Dvořák', 'Dvořáku'],
    ['Josef Němec', 'Němče'],       // -ec, jediná povolená výjimka
    ['Pavel Svoboda', 'Svobodo'],
    ['Milan Dušek', 'Dušku'],
    ['Tomáš Beneš', 'Beneši'],
    ['Karel Bartoš', 'Bartoši'],
    ['Martin Kovář', 'Kováři'],
    ['David Holub', 'Holube']
  ];

  for (const [vstup, tvar] of muzi) {
    it(`${vstup} → pane ${tvar}`, () => {
      assert.equal(formalGreetingName(vstup), `pane ${tvar}`);
      assert.equal(greeting(vstup), `Dobrý den, pane ${tvar},`);
    });
  }

  it('křestní jméno slouží jen k určení rodu, na tvar nemá vliv', () => {
    assert.equal(formalGreetingName('Jan Hrubeš'), 'pane Hrubeši');
    assert.equal(formalGreetingName('Ondřej Hrubeš'), 'pane Hrubeši');
  });
});

describe('oslovení — pravidlo pro měkkou souhlásku (-š -ž -č -ř -j → -i)', () => {
  const mekke = [
    ['Ondřej Hrubeš', 'Hrubeši'],
    ['Jan Mareš', 'Mareši'],
    ['Tomáš Beneš', 'Beneši'],
    ['Karel Bartoš', 'Bartoši'],
    ['Petr Kříž', 'Kříži'],
    ['Martin Kovář', 'Kováři'],
    ['Josef Bednář', 'Bednáři'],
    ['Pavel Tesař', 'Tesaři']
  ];

  for (const [vstup, tvar] of mekke) {
    it(`${vstup} → pane ${tvar}`, () => {
      assert.equal(formalGreetingName(vstup), `pane ${tvar}`);
    });
  }

  it('ručně ověřená tabulka vyhrává nad pravidlem — u všech svých položek', () => {
    /* Pozor na past: dnes se tabulka a pravidlo shodují u všech příjmení
       na měkkou souhlásku, takže samotná záměna pořadí v kódu by se navenek
       vůbec neprojevila. Proto se tu nekontroluje jedno jméno, ale celá
       tabulka: kdyby někdo v budoucnu doplnil příjmení, kde se ověřený tvar
       od pravidla liší (typicky cizí jméno na -š), tenhle test okamžitě
       ukáže, jestli má navrch tabulka. Tabulka je referenční pravda. */
    const zdroj = readFileSync(new URL('./_vocative.mjs', import.meta.url), 'utf8');
    const tabulka = zdroj.match(/const SURNAME_VOCATIVE = \{[\s\S]*?\n\};/)[0];
    const dvojice = [...tabulka.matchAll(/'([^']+)':'([^']+)'/g)].map((m) => [m[1], m[2]]);

    assert.ok(dvojice.length >= 100, 'tabulka se nenačetla celá');

    for (const [prijmeni, tvar] of dvojice) {
      assert.equal(
        formalGreetingName(`Jan ${prijmeni}`),
        `pane ${tvar}`,
        `u „${prijmeni}" musí platit ověřený tvar „${tvar}", ne odvozený`
      );
    }
  });

  it('velikost písmen na vstupu tvar nerozbije', () => {
    for (const vstup of ['Ondřej Hrubeš', 'ondřej hrubeš', 'Ondřej HRUBEŠ']) {
      assert.equal(formalGreetingName(vstup), 'pane Hrubeši', vstup);
    }
  });

  it('rod se pořád musí potvrdit křestním jménem', () => {
    /* Měkká souhláska sama o sobě není důkaz, že jde o muže. */
    assert.equal(formalGreetingName('Xaver Hrubeš'), '');
    assert.equal(greeting('Xaver Hrubeš'), 'Dobrý den,');
  });
});

describe('oslovení — pravidlo se NESMÍ přetáhnout na -c a -ec', () => {
  it('Němec zůstává Němče (tabulka má přednost před pravidlem)', () => {
    assert.equal(formalGreetingName('Josef Němec'), 'pane Němče');
    assert.notEqual(formalGreetingName('Josef Němec'), 'pane Němeci');
  });

  const mimoPravidlo = ['Jan Moravec', 'Jan Kadlec', 'Jan Švec'];

  for (const vstup of mimoPravidlo) {
    it(`„${vstup}" nespadne pod pravidlo ani se neuhodne`, () => {
      const prijmeni = vstup.split(' ').pop();
      assert.equal(formalGreetingName(vstup), '', `${prijmeni} nemá ověřený tvar`);
      assert.equal(greeting(vstup), 'Dobrý den,');
      assert.ok(
        !greeting(vstup).includes(prijmeni + 'i'),
        `nesmí vzniknout „${prijmeni}i"`
      );
    });
  }

  it('žádné příjmení na -c pravidlo nechytí', () => {
    for (const p of ['němec', 'moravec', 'kadlec', 'švec', 'vrabec']) {
      assert.ok(!/[šžčřj]$/.test(p), `${p} nesmí odpovídat množině měkkých souhlásek`);
    }
  });
});

describe('oslovení — ženy a přídavná příjmení (5. pád = 1. pád)', () => {
  const nemenne = [
    ['Jana Nováková', 'paní Nováková'],
    ['Eva Novotná', 'paní Novotná'],
    ['Žofie Křížová', 'paní Křížová'],
    ['Jana Hrubešová', 'paní Hrubešová'],
    ['Jan Novotný', 'pane Novotný'],
    ['Karel Krejčí', 'pane Krejčí']
  ];

  for (const [vstup, oslov] of nemenne) {
    it(`${vstup} → ${oslov}`, () => {
      assert.equal(formalGreetingName(vstup), oslov);
    });
  }
});

describe('oslovení — kdy se radši vynechá', () => {
  const obecne = [
    ['Ondřej Vomáčka', 'příjmení není v ověřené tabulce'],
    ['Jan Kadlec', 'příjmení na -ec je schválně vynechané'],
    ['Jan Nguyen', 'cizí příjmení bez ustáleného českého 5. pádu'],
    ['Jana Krejčí', 'žena poznaná jen podle křestního jména'],
    ['Novák', 'jedno slovo — nevíme, co je jméno a co příjmení'],
    ['Topení Servis s.r.o.', 'firma, ne člověk'],
    ['jan.novak@example.com', 'e-mail místo jména'],
    ['Jan Novák 2', 'číslice v hodnotě'],
    ['', 'prázdná hodnota']
  ];

  for (const [vstup, proc] of obecne) {
    it(`„${vstup}" → obecné oslovení (${proc})`, () => {
      assert.equal(formalGreetingName(vstup), '');
      assert.equal(greeting(vstup), 'Dobrý den,');
    });
  }

  it('nezadané jméno nikdy nespadne na výjimku', () => {
    for (const vstup of [undefined, null, 0, false]) {
      assert.equal(greeting(vstup), 'Dobrý den,');
    }
  });
});

describe('oslovení — příjmení se nikdy nepoužije v 1. pádu', () => {
  /* Příjmení, kde se 5. pád od 1. liší. Kdyby se do oslovení dostal
     nesklonovaný tvar, je to chyba i v případě, že „nějaké" oslovení vznikne. */
  const musiSeOhnout = [
    'Ondřej Hrubeš', 'Jan Novák', 'Petr Dvořák', 'Josef Němec',
    'Pavel Svoboda', 'Milan Dušek', 'Tomáš Beneš', 'Martin Kovář'
  ];

  for (const vstup of musiSeOhnout) {
    it(`„${vstup}" — v oslovení není 1. pád příjmení`, () => {
      const prijmeni = vstup.split(' ').pop();
      const oslov = formalGreetingName(vstup);

      assert.notEqual(oslov, '', 'tohle jméno má systém umět');
      assert.ok(
        !oslov.endsWith(` ${prijmeni}`),
        `oslovení „${oslov}" obsahuje nesklonované „${prijmeni}"`
      );
      assert.ok(
        !greeting(vstup).includes(`pane ${prijmeni},`),
        `e-mail by začínal „pane ${prijmeni}," místo 5. pádu`
      );
    });
  }

  it('u přídavných a ženských příjmení je shoda s 1. pádem správně', () => {
    /* Kontrola naopak: tady se tvar měnit NEMÁ. */
    assert.equal(formalGreetingName('Jan Novotný'), 'pane Novotný');
    assert.equal(formalGreetingName('Jana Nováková'), 'paní Nováková');
  });
});
