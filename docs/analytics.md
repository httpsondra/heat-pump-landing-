# Analytika webu MD-Therm

Fáze 1: důvěryhodný základ na webu. CRM přehled se zatím **nestaví**.

Dělba rolí:

| | |
|---|---|
| **PostHog** | podrobná návštěvnost a chování na webu |
| **CRM** | zdroj pravdy o poptávkách, zákaznících a zakázkách |

Do PostHogu jdou **jen kategorie a kontext**, osobní údaje zůstávají v CRM.

---

## Inicializace

`index.html`, na konci `<body>`. Odkládá se na nečinnost prohlížeče, aby
nesoupeřila s vykreslením.

```js
posthog.init('phc_…', {
  api_host: 'https://eu.i.posthog.com',
  person_profiles: 'identified_only',
  defaults: '2025-05-24',
  autocapture: false,
  disable_session_recording: true,
  capture_pageview: true
});
```

* **`autocapture: false`** — sbírají se jen vlastní pojmenované události.
  Autocapture by bral kliky a texty prvků napříč stránkou: víc dat, horší signál
  a větší riziko, že se něco nechtěného zachytí.
* **`disable_session_recording: true`** — ve Fázi 1 se nenahrává. Formulář nese
  jméno, telefon i e-mail; než se replay zapne, musí projít revize maskování.
  Vypnuto **z kódu**, takže to neovlivní jiné projekty v účtu.
* **`capture_pageview: true`** — schválně explicitně, ne z balíku `defaults`.
  Web je jedna stránka s kotvami (`#sluzby`, `#poptavka`, …) a režim
  `'history_change'` by z každé kotvy udělal další pageview.
  **Jedno načtení dokumentu = jeden pageview.**
* **`person_profiles: 'identified_only'`** a `identify()` se nikde nevolá →
  všechny události jsou anonymní.

### Produkce vs. vývoj

Před inicializací stojí kontrola domény:

```js
if (h !== 'md-therm.cz' && h !== 'www.md-therm.cz') return;
```

Na `localhost`, `127.0.0.1`, náhledech `*.vercel.app` i lokálních testovacích
stránkách se PostHog **vůbec nenačte** — žádný požadavek, žádná událost.
Druhý projekt pro vývoj se nezakládá; na jednostránkový web je to zbytečná režie.

### Fronta událostí

`array.js` se stahuje až v nečinnosti, takže v prvních vteřinách PostHog
neexistuje. Kdo ťukne na „Zavolat" hned po načtení, by o událost přišel.
`js/form.js` proto události zařadí do fronty (max 20) a `boot()` ji po
inicializaci vyprázdní přes `window.__mdthermFlush()`.

---

## Schéma událostí

| Událost | Kdy | Vlastnosti |
|---|---|---|
| `phone_clicked` | aktivace odkazu `tel:` | `location` |
| `email_clicked` | aktivace odkazu `mailto:` | `location` |
| `inquiry_started` | **první skutečná** interakce s formulářem | `entry_point`, `service`* |
| `inquiry_step_completed` | posun na další krok | `step` (1–6) |
| `inquiry_submitted` | **jen** po `success:true` od Web3Forms | `service`, `building_type`, `situation`, `entry_point`, `submission_id` |
| `inquiry_failed` | odeslání se nepovedlo | `reason` |
| `confirmation_failed` | `/api/potvrzeni` vrátil chybu | `status` |

\* `service` jen když je známá.

`location`: `topbar · hero · form_urgent · form_success · form_error · cta_band · contact · footer · mobilebar`
`entry_point`: `services · hero · topbar · comparison · cta_band · contact · mobilebar · direct`

### Důvody selhání

`inquiry_failed.reason` je **uzavřený číselník** — odpovídá přesně větvím,
které v kódu existují:

| `reason` | Kdy |
|---|---|
| `missing_config` | chybí `WEB3FORMS_ACCESS_KEY` — nic se neodeslalo |
| `provider_rejected` | Web3Forms odpověděl `success:false` |
| `timeout` | request se nestihl do 15 s |
| `network_error` | síť nebo fetch selhaly |
| `unknown` | pojistka pro cokoli mimo seznam |

Text výjimky ani zpráva od Web3Forms se do analytiky **nedostanou nikdy** —
nesou cizí formulace, mohou obsahovat vstup uživatele a rozstřelily by
kardinalitu. Zpráva poskytovatele zůstává pro ladění v konzoli.
Hodnotu filtruje `failReason()` v `js/form.js`.

`confirmation_failed.status` je číselný HTTP status (`400`, `429`, `502`, …)
nebo `network_error`, případně `unknown`. Žádné tělo odpovědi.

### `inquiry_started`

Fire **až při první opravdové interakci** s formulářem (první `change` nebo
`input`).

Klik na CTA nebo na kartu služby **není** zahájená poptávka — jen se poznamená
kontext do `sessionStorage` (`md-poptavka-ctx-v1`) a čeká se. Skok z karty
proto ani nehlásí `inquiry_step_completed`: ten krok vyplnil program, ne člověk.

```
Služby → Tepelné čerpadlo → Nezávazně poptat     → jen kontext, žádná událost
první volba ve formuláři                          → inquiry_started
                                                     { entry_point: "services",
                                                       service: "heat_pump" }
```

Pojistka `started` přežije obnovení stránky (obnoví ji `restore()` z rozepsané
poptávky), takže na jeden pokus padne **jedna** událost.

### `inquiry_submitted`

Jediné autoritativní místo je `showDone()` v `js/form.js` — tam se kód dostane
až po `success:true` od Web3Forms.

**Nefire** při: kliknutí na odeslat, projité validaci, začátku requestu,
chybějícím access keyi, timeoutu, síťové chybě ani `success:false`.

Potvrzovací e-mail a kopie do CRM běží na pozadí a **konverzi neovlivňují** —
poptávka je zachycená ve chvíli, kdy ji potvrdí Web3Forms.

---

## Osobní údaje

**Nikdy do PostHogu:** jméno · telefon · e-mail · město · PSČ · volný popis ·
model/výrobní číslo zařízení · celý obsah formuláře · ID zákazníka z CRM.

**Povolené kategorie** (uzavřené číselníky z přepínačů, normalizované na
stabilní klíče):

| Pole | Klíče |
|---|---|
| `service` | `heat_pump · air_conditioning · gas_boiler · service · unsure` |
| `building_type` | `house · apartment · commercial · other_building` |
| `situation` | `exploring · building_renovating · replacing_source · quote_request · not_working · error_code · poor_performance · maintenance` |

Mapování je v `js/form.js` (`SERVICE_KEYS`, `BUILDING_KEYS`, `SITUATION_KEYS`).
Neznámá hodnota končí jako `other` — **surový text formuláře se neposílá nikdy**.
Po přidání nové volby doplnit i mapu.

Dřívější vlastnost `mesto` byla odstraněna: město je součást adresy a v CRM
už je.

---

## Atribuce

Z PostHogu nativně, **znovu se to nevytváří**: `utm_*`, `$referrer`,
`$referring_domain`, `$current_url`, `gclid`/`fbclid`, relace, zařízení.

### Snímek prvního dotyku

Pro budoucí spojení s CRM se odděleně ukládá malý snímek:

| | |
|---|---|
| **Kde** | `localStorage`, klíč `md-first-touch-v1` |
| **Kdy** | při prvním načtení webu v daném prohlížeči |
| **Co** | `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `click_id` (`gclid`/`fbclid`), `initial_referrer` (jen doména), `landing_page` (jen cesta), `captured_at` |
| **Platnost** | **90 dní** od `captured_at` |
| **Přepis** | uvnitř okna **nikdy** — `captured_at` se ani neobnovuje, jinak by z prvního dotyku vznikl posuvný poslední dotyk |
| **Vypršení** | po 90 dnech je snímek neplatný; příští návštěva založí nový |
| **Reset** | vypršením nebo smazáním úložiště prohlížeče |

Okno je pevné, ne posuvné: návrat po 30 i po 89 dnech drží původní kampaň,
teprve 91. den smí vzniknout nový první dotyk. Konstanta
`FIRST_TOUCH_MAX_AGE_MS` v `js/form.js`.

Neobsahuje osobní údaje. Ve Fázi 1 se **nikam neodesílá** — čeká na rozšíření
kontraktu CRM.

---

## Budoucí spojení s CRM (nestaví se)

Most už existuje: `submissionId` = náhodné `crypto.randomUUID()`, které formulář
posílá do Web3Forms i do `/api/potvrzeni` → CRM.

Od Fáze 1 jde stejná hodnota i do PostHogu jako `submission_id`
u `inquiry_submitted`. Záruky:

* generuje se **náhodně pro každé odeslání** (`crypto.randomUUID()`, záloha
  `crypto.getRandomValues`),
* **není odvozené** ze jména, e-mailu, telefonu ani jiných údajů zákazníka,
* **není to ID zákazníka z CRM** — to se do PostHogu neposílá nikdy,
* existuje **výhradně jako spojovací klíč**, sám o sobě nikoho neidentifikuje,
* umožní později připojit obchodní výsledek z CRM (zakázka, hodnota)
  k akvizičním datům, aniž by do PostHogu tekly osobní údaje.

```
PostHog  inquiry_submitted { submission_id }
                 ↕  spojení přes UUID
CRM      poptávka { submissionId, jméno, telefon, e-mail }
```

Až se bude chtít zdroj i v CRM, přidá se snímek prvního dotyku do payloadu
poptávky. **Vyžaduje změnu v obou repozitářích** — `MAPPING` v `api/_crm.mjs`
i `validateIngest` v CRM jsou přísné whitelisty. Není součástí Fáze 1.

ID zákazníka z CRM do PostHogu **nikdy**.

---

## Co se schválně nesleduje

Interaktivní dům · otevření FAQ · hloubka scrollu · zobrazení sekcí · obecné
kliky · pohyb myší · otevření menu · `cta_clicked`.

CTA by jen zdvojilo `inquiry_started` (to už nese `entry_point` i `service`).
U interaktivního domu je signál lepší z karet služeb a z odpovědi ve formuláři.

---

## Fáze 2 — kontrolní seznam

Po prvních dnech provozu ověřit:

- [ ] pageviews se nezdvojují; kotvy (`#sluzby`, …) nevyrábějí další pageview
- [ ] počty relací a unikátních návštěvníků dávají smysl
- [ ] z `localhost` ani z náhledů nechodí nic
- [ ] `phone_clicked` — jedna aktivace = jedna událost; `location` sedí
- [ ] `email_clicked` — totéž
- [ ] `inquiry_started` padá jednou za pokus, s `entry_point`
- [ ] `inquiry_step_completed` ukazuje, kde lidé odpadají
- [ ] `inquiry_submitted` odpovídá počtu poptávek v CRM
- [ ] neúspěšné odeslání nikdy nevyrobí konverzi
- [ ] v žádné události není jméno, telefon, e-mail, adresa ani volný text
- [ ] atribuce (`utm_*`) přežije cestu webem až ke konverzi

### Nastavit ručně v PostHogu

- **Session replay** — ověřit stav na úrovni projektu. Z kódu je vypnutý
  (`disable_session_recording: true`), ale nastavení projektu je vidět jen
  v administraci. Než se někdy zapne: zkontrolovat maskování polí formuláře.
- **Autocapture** — z kódu vypnutý; případné dřívější autocapture události
  zůstávají v historických datech.
