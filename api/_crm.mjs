/* =========================================================================
   Předání poptávky do CRM — JEDINÉ místo, kde web ví, jak vypadá CRM
   -------------------------------------------------------------------------
   Web3Forms zůstává hlavním kanálem: poptávka je zachycená ve chvíli, kdy
   ji potvrdí. Tohle je KOPIE navíc. Když selže, zákazník o tom nesmí vědět
   a poptávka se neztrácí — proto se odsud nikdy nevyhazuje výjimka nahoru
   a proto se výsledek nepromítá do odpovědi pro prohlížeč.

   Celý překlad „názvy polí z webu → smlouva CRM" je v MAPPING níž. Když se
   na webu přejmenuje pole nebo přibude nové, mění se JEDEN řádek tady;
   nikde jinde v odesílací cestě se o CRM neví. Popisky, texty ani pořadí
   kroků formuláře na tuhle vrstvu nemají žádný vliv.

   Tajemství (MDT_LEAD_INGEST_SECRET) žije výhradně v proměnné prostředí na
   serveru. Do prohlížeče, do HTML ani do logu se nedostane.
   ========================================================================= */
import { createHash, randomUUID } from 'node:crypto';

export const CRM_ENDPOINT = 'https://crm.md-therm.cz/api/poptavky';

/* Kolik času smí kopie do CRM zabrat. Funkce má na Vercelu 10 s celkem
   a potvrzovací e-mail běží souběžně — pět sekund je strop, po kterém je
   rozumnější to vzdát než držet zákazníka. */
export const CRM_TIMEOUT_MS = 5000;

/**
 * Překlad polí. Vlevo název z webového formuláře, vpravo pole smlouvy CRM.
 *
 * Co v seznamu není, se NEODESÍLÁ — včetně honeypotu `web`, řídicích polí
 * Web3Forms a čehokoli, co by někdo do požadavku přidal navíc.
 */
export const MAPPING = Object.freeze({
  jmeno: 'name',
  email: 'email',
  telefon: 'phone',
  telefonE164: 'phoneE164',
  sluzba: 'service',
  objekt: 'propertyType',
  situace: 'situation',
  mesto: 'city',
  psc: 'postalCode',
  zarizeni: 'device',
  popis: 'message'
});

/* Meze podle smlouvy CRM (server/inquiries/ingest.ts). Delší hodnotu by
   CRM stejně oříznulo — ořezat ji tady znamená poslat přesně to, co se
   uloží, a nespoléhat se v tomhle na druhou stranu. */
const LIMITS = Object.freeze({
  name: 120, email: 254, phone: 40, phoneE164: 20, service: 80,
  propertyType: 80, situation: 120, city: 80, postalCode: 16,
  device: 160, message: 4000
});

/* Jediné pole, které smí obsahovat odřádkování — zákazníkův text zůstává
   tak, jak ho napsal. Ostatní se slučují na jeden řádek. */
const MULTILINE = 'message';

/* Řídicí znaky pryč. U víceřádkového pole zůstává jen odeslání
   řádku (\n). Zapsané escape sekvencemi schválně — skutečný řídicí znak
   ve zdrojovém kódu není vidět a při čtení diffu se přehlédne. */
const CTRL = /[\u0000-\u001f\u007f]/g;
const CTRL_KEEP_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

function oneLine(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function paragraph(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CTRL_KEEP_NEWLINE, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/**
 * Payload z webu → payload pro CRM.
 *
 * Diakritika se nikde nepřepisuje ani nepřevádí; řetězce se jen zbavují
 * řídicích znaků a zkracují. Prázdná nepovinná pole se vynechávají, ať
 * CRM nedostává prázdné řetězce místo „nevyplněno".
 */
export function normalizeWebsiteInquiry(body) {
  const source = (body && typeof body === 'object') ? body : {};
  const out = {};

  for (const [websiteField, crmField] of Object.entries(MAPPING)) {
    const limit = LIMITS[crmField];
    const value = crmField === MULTILINE
      ? paragraph(source[websiteField], limit)
      : oneLine(source[websiteField], limit);

    /* Povinná pole posíláme vždy, ať CRM samo řekne, co chybí.
       Nepovinná jen když mají obsah. */
    const required = crmField === 'name' || crmField === 'email' || crmField === 'phone';
    if (value || required) out[crmField] = value;
  }

  return out;
}

/**
 * Klíč odeslání pro CRM (hlavička Idempotency-Key).
 *
 * CRM ho vyžaduje a schválně si ho nedopočítává z obsahu: tentýž člověk
 * smí poslat tutéž poptávku dvakrát a druhá nesmí tiše zmizet.
 *
 * Klíč se skládá TADY NA SERVERU. Prohlížeč přikládá jen náhodný
 * identifikátor jednoho odeslání (`submissionId`) — server z něj udělá
 * otisk, takže klient neurčuje výslednou hodnotu ani její tvar. Opakované
 * doručení téhož požadavku tak nese tentýž klíč a CRM ho pozná jako
 * duplicitu; dvě různá odeslání mají různý identifikátor, a tedy různý klíč.
 *
 * Když identifikátor chybí (stará verze skriptu z mezipaměti prohlížeče),
 * použije se náhodný klíč. Je to vědomá volba: raději jedna poptávka navíc,
 * kterou je vidět a jde smazat, než poptávka tiše spolknutá jako domnělá
 * duplicita. Ztracená poptávka je horší než duplicitní.
 */
export function submissionKey(body, deps = {}) {
  const uuid = deps.randomUUID || randomUUID;
  const raw = body && typeof body.submissionId === 'string' ? body.submissionId.trim() : '';

  if (/^[A-Za-z0-9._:-]{8,128}$/.test(raw)) {
    return 'web-' + createHash('sha256').update('mdt-poptavka:' + raw).digest('hex').slice(0, 40);
  }
  return 'web-nahodny-' + uuid();
}

/**
 * Odeslání kopie do CRM.
 *
 * Nikdy nevyhazuje výjimku: vrací popis výsledku, se kterým volající naloží
 * tak, že ho jen zaznamená. Do návratové hodnoty se nedostane nic z těla
 * odpovědi CRM kromě stavového kódu — a tajemství už vůbec ne.
 */
export async function forwardToCrm(payload, idempotencyKey, options = {}) {
  const secret = options.secret;
  if (!secret) return { ok: false, reason: 'not-configured' };

  const endpoint = options.endpoint || CRM_ENDPOINT;
  const doFetch = options.fetch || globalThis.fetch;
  const timeoutMs = options.timeoutMs || CRM_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + secret,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    /* 201 = nová poptávka, 200 = tatáž poptávka podruhé. Obojí je úspěch:
       v CRM je právě jeden záznam, což je přesně to, co chceme. */
    if (response.status === 201) return { ok: true, status: 201, duplicate: false };
    if (response.status === 200) return { ok: true, status: 200, duplicate: true };

    return { ok: false, reason: 'rejected', status: response.status };
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    return { ok: false, reason: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Celý krok „pošli kopii do CRM" i s poznámkou do logu.
 *
 * Do logu jde stavový kód a důvod, nikdy obsah poptávky ani tajemství.
 */
export async function forwardInquiryToCrm(body, options = {}) {
  const payload = normalizeWebsiteInquiry(body);
  const key = submissionKey(body, options);
  const result = await forwardToCrm(payload, key, {
    ...options,
    secret: options.secret ?? process.env.MDT_LEAD_INGEST_SECRET
  });

  if (result.ok) {
    console.log('[crm] poptavka predana, status=' + result.status + (result.duplicate ? ' (duplicita)' : ''));
  } else if (result.reason === 'not-configured') {
    console.error('[crm] MDT_LEAD_INGEST_SECRET neni nastaveny - kopie do CRM se neodeslala.');
  } else {
    console.error('[crm] predani selhalo: ' + result.reason + (result.status ? ' HTTP ' + result.status : ''));
  }

  return result;
}
