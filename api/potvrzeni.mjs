/* =========================================================================
   POST /api/potvrzeni — co se stane PO úspěšném odeslání poptávky
   -------------------------------------------------------------------------
   Volá se z formuláře AŽ POTÉ, co Web3Forms potvrdí přijetí poptávky.
   Web3Forms je kritický systém (sběr poptávek), tenhle endpoint ne:
   když selže, zákazník o tom nesmí vědět a poptávka zůstává v pořádku.

   Dělá dvě NEZÁVISLÉ věci:
     1) pošle zákazníkovi potvrzovací e-mail (Resend),
     2) pošle kopii poptávky do CRM (viz `_crm.mjs`).

   Nezávislé znamená doopravdy nezávislé: běží souběžně, jedno nečeká na
   druhé a selhání jednoho nesmí zabránit druhému. Nenastavený Resend proto
   nesmí zastavit odeslání do CRM — a naopak. Odpověď pro prohlížeč se řídí
   jenom e-mailem, aby se chování formuláře přidáním CRM nezměnilo.

   Konfigurace žije v proměnných prostředí na Vercelu:
     RESEND_API_KEY … povinné, klíč z resend.com  (NIKDY do gitu)
     RESEND_FROM    … volitelné; odesílatel. Výchozí je adresa níže.
                      Až firma přejde na jinou doménu, stačí přepsat
                      tuhle proměnnou — v kódu se nemění nic.

   Příjemce se NEBERE z požadavku: server použije e-mail z formuláře,
   který si sám zvaliduje. Odesílatele klient neovlivní vůbec.
   ========================================================================= */
import { greeting } from './_vocative.mjs';
import { forwardInquiryToCrm } from './_crm.mjs';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'MD-Therm <noreply@md-therm.cz>';
const PHONE_HREF = '+420603479240';
const PHONE_TEXT = '+420 603 479 240';

/* Přijímáme jen tahle pole a nic jiného. Hodnoty se ořežou na rozumnou
   délku, ať se do e-mailu nedá propašovat román. */
const FIELDS = {
  jmeno: 80,
  email: 160,
  sluzba: 60,
  objekt: 60,
  situace: 80,
  mesto: 80,
  psc: 10,
  zarizeni: 120
};

/* Volný text od zákazníka. Řeší se zvlášť, protože jako jediný smí
   obsahovat konce řádků — clean() je jinde záměrně slučuje do mezery. */
const POPIS_MAX = 2000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/g;

/* Nejjednodušší ochrana proti zahlcení. Serverless instance se recyklují,
   takže je to hrubý strop, ne skutečný rate limiter — pro tenhle formulář
   to stačí a nevyžaduje to žádnou další infrastrukturu. */
const HITS = new Map();
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip) {
  const now = Date.now();
  const rec = HITS.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    HITS.set(ip, { start: now, n: 1 });
    if (HITS.size > 500) HITS.clear();          // pojistka proti růstu paměti
    return false;
  }
  rec.n += 1;
  return rec.n > MAX_PER_WINDOW;
}

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(CTRL_RE, ' ')      // řídicí znaky pryč
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* Jako clean(), ale zachová odřádkování — text zákazníka má zůstat tak,
   jak ho napsal. Slučují se jen vodorovné mezery a víc než jeden prázdný
   řádek; obsah samotný se nijak nepřepisuje. */
function cleanMultiline(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')                  // sjednotit konce řádků
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')  // vsechny ridici znaky krome odradkovani
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(function (l) { return l.trim(); }).join('\n')
    .replace(/\n{3,}/g, '\n\n')               // nejvýš jeden prázdný řádek
    .trim()
    .slice(0, max);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* PSČ se zobrazuje po česku: 141 00. */
function formatPsc(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 5);
  return d.length === 5 ? d.slice(0, 3) + ' ' + d.slice(3) : d;
}

function summaryRow(label, value, first, secondary) {
  const divider = first ? '' : `
                    <tr><td style="border-top:1px solid #eceef1; font-size:0; line-height:0;">&nbsp;</td></tr>`;
  /* Dvě váhy hodnot:
       · hlavní údaje (služba, objekt, situace, lokalita) tučně 16px,
       · doplňkové údaje od zákazníka (popis, zařízení) normální vahou —
         obojí je „něco navíc", tak ať to má i stejnou váhu.
     Popisky zůstávají v obou případech stejné. */
  const valueStyle = secondary
    ? 'display:block; margin-top:5px; font-size:15px; line-height:23px; font-weight:400; color:#3b4149;'
    : 'display:block; margin-top:3px; font-size:16px; font-weight:600; color:#111111;';
  /* Odřádkování se převádí vždy; reálně ho může obsahovat jen „popis",
     ostatní pole projdou clean(), který konce řádků slučuje na mezeru. */
  const rendered = esc(value).replace(/\n/g, '<br>');
  return `${divider}
                    <tr>
                      <td style="padding:${first ? '0 0 14px 0' : '14px 0 0 0'}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                        <span style="display:block; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#6b7280;">${esc(label)}</span>
                        <span style="${valueStyle}">${rendered}</span>
                      </td>
                    </tr>`;
}

function buildEmail(d) {
  const hello = greeting(d.jmeno);
  const psc = formatPsc(d.psc);
  const lokalita = [d.mesto, psc].filter(Boolean).join(', ');

  /* Nepovinné údaje se do shrnutí dostanou jen když opravdu existují.
     Prázdný „Popis situace" se tedy neprojeví vůbec — žádný nadpis
     ani prázdné místo. Text se přebírá doslova, jen escapovaný. */
  const summary = [
    ['Služba', d.sluzba, false],
    ['Objekt', d.objekt, false],
    ['Situace', d.situace, false],
    ['Lokalita', lokalita, false],
    ['Doplňující informace', d.popis, true],
    ['Zařízení', d.zarizeni, true]
  ].filter(function (pair) { return pair[1]; });

  const rowsHtml = summary.map(function (pair, i) {
    return summaryRow(pair[0], pair[1], i === 0, pair[2]);
  }).join('');

  const summaryBlock = summary.length ? `
        <tr>
          <td class="sm-p" style="padding:30px 44px 0 44px;">
            <p style="margin:0 0 12px 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#6b7280;">
              Shrnutí poptávky
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafbfc; border:1px solid #eceef1; border-radius:10px;">
              <tr><td style="padding:20px 22px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}
                </table>
              </td></tr>
            </table>
          </td>
        </tr>` : '';

  const html = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Poptávku jsme přijali</title>
<style>
  body { margin:0; padding:0; width:100% !important; }
  table { border-collapse:collapse; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; }
  a { color:#A23707; }
  @media only screen and (max-width:600px) {
    .sm-p { padding-left:22px !important; padding-right:22px !important; }
    .sm-p-top { padding-top:28px !important; }
    .sm-p-bottom { padding-bottom:28px !important; }
    .sm-h1 { font-size:22px !important; line-height:30px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#f4f5f7;">
<div style="display:none; font-size:1px; color:#f4f5f7; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
  Vaše poptávka k nám dorazila v pořádku. Ozveme se vám co nejdříve.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#ffffff; border:1px solid #e6e8eb; border-radius:14px; overflow:hidden;">
        <tr><td style="height:3px; background-color:#F4550E; font-size:0; line-height:0;">&nbsp;</td></tr>
        <tr>
          <td class="sm-p sm-p-top" style="padding:38px 44px 0 44px;">
            <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:17px; font-weight:700; letter-spacing:-0.01em; color:#111111;">MD‑Therm</p>
            <p style="margin:5px 0 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; letter-spacing:0.06em; text-transform:uppercase; color:#6b7280;">
              Tepelná čerpadla &nbsp;•&nbsp; Klimatizace &nbsp;•&nbsp; Servis
            </p>
          </td>
        </tr>
        <tr>
          <td class="sm-p" style="padding:30px 44px 0 44px;">
            <h1 class="sm-h1" style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:26px; line-height:34px; font-weight:700; letter-spacing:-0.02em; color:#111111;">
              Poptávku jsme přijali
            </h1>
            <p style="margin:22px 0 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:26px; color:#3b4149;">${esc(hello)}</p>
            <p style="margin:14px 0 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:26px; color:#3b4149;">
              děkujeme za vaši poptávku. Dorazila k nám v pořádku a ozveme se vám co nejdříve,
              abychom domluvili další postup.
            </p>
          </td>
        </tr>${summaryBlock}
        <tr>
          <td class="sm-p" style="padding:28px 44px 0 44px;">
            <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:26px; color:#3b4149;">
              Pokud potřebujete něco řešit urgentně, můžete nám zavolat na
              <a href="tel:${PHONE_HREF}" style="color:#A23707; font-weight:600; text-decoration:none; white-space:nowrap;">+420&nbsp;603&nbsp;479&nbsp;240</a>.
            </p>
          </td>
        </tr>
        <tr>
          <td class="sm-p sm-p-bottom" style="padding:32px 44px 40px 44px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid #eceef1; font-size:0; line-height:0; padding-bottom:22px;">&nbsp;</td></tr>
              <tr><td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0; font-size:15px; font-weight:700; color:#111111;">MD‑Therm</p>
                <p style="margin:4px 0 0 0; font-size:13px; line-height:20px; color:#6b7280;">
                  Tepelná čerpadla &nbsp;•&nbsp; Klimatizace &nbsp;•&nbsp; Servis
                </p>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">
        <tr><td class="sm-p" style="padding:20px 44px 0 44px; text-align:center;">
          <p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:19px; color:#8b9199;">
            Tento e-mail vám přišel jako potvrzení poptávky odeslané z webu md-therm.cz.
          </p>
        </td></tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const textLines = ['Poptávku jsme přijali — MD-Therm', '', hello, '',
    'děkujeme za vaši poptávku. Dorazila k nám v pořádku a ozveme se vám',
    'co nejdříve, abychom domluvili další postup.', ''];
  if (summary.length) {
    textLines.push('SHRNUTÍ POPTÁVKY', '');
    summary.forEach(function (pair) { textLines.push(pair[0] + ':', pair[1], ''); });
  }
  textLines.push('Pokud potřebujete něco řešit urgentně, můžete nám zavolat',
    'na ' + PHONE_TEXT + '.', '', 'MD-Therm',
    'Tepelná čerpadla • Klimatizace • Servis', '', '--',
    'Tento e-mail vám přišel jako potvrzení poptávky odeslané z webu md-therm.cz.');

  return { html: html, text: textLines.join('\n') };
}

/**
 * Potvrzovací e-mail zákazníkovi. Vrací stavový kód, který se má vrátit
 * prohlížeči — chování se oproti dřívějšku nemění.
 */
async function sendConfirmationEmail(d) {
  // Chybějící klíč = špatná konfigurace. Ven jde jen obecná chyba.
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[potvrzeni] RESEND_API_KEY neni nastaveny - e-mail se neodeslal.');
    return 500;
  }

  const mail = buildEmail(d);

  try {
    const payload = {
      from: process.env.RESEND_FROM || DEFAULT_FROM,
      /* Příjemce = e-mail z formuláře, který prošel validací.
         Z požadavku se nikdy nebere `to` ani `from`. */
      to: [d.email],
      reply_to: d.email,
      subject: 'Poptávku jsme přijali — MD-Therm',
      html: mail.html,
      text: mail.text,
      tags: [{ name: 'typ', value: 'potvrzeni-poptavky' }]
    };
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      // Do logu jde stav a zpráva od Resendu, nikdy klíč.
      let detail = '';
      try { detail = JSON.stringify(await resp.json()).slice(0, 400); } catch (e) { /* ignore */ }
      console.error('[potvrzeni] Resend odmitl odeslani: HTTP ' + resp.status + ' ' + detail);
      return 502;
    }

    const data = await resp.json().catch(function () { return {}; });
    console.log('[potvrzeni] odeslano id=' + (data.id || '?'));
    return 200;
  } catch (err) {
    console.error('[potvrzeni] Odeslani selhalo:', err && err.message);
    return 502;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ ok: false });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ ok: false }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false });

  // Whitelist pro e-mail — cokoli navíc se zahodí.
  const d = {};
  Object.keys(FIELDS).forEach(function (key) { d[key] = clean(body[key], FIELDS[key]); });
  d.popis = cleanMultiline(body.popis, POPIS_MAX);   // jediné pole s odřádkováním

  if (!EMAIL_RE.test(d.email)) return res.status(400).json({ ok: false });

  /* Dvě nezávislé věci naráz. `allSettled` schválně: ani výjimka v jedné
     větvi nesmí shodit druhou. Do CRM jde původní tělo požadavku — svůj
     výběr a ořez polí si adaptér dělá sám podle smlouvy CRM. */
  const [mail] = await Promise.allSettled([
    sendConfirmationEmail(d),
    forwardInquiryToCrm(body)
  ]);

  /* Odpověď se řídí JEN potvrzovacím e-mailem. Stav CRM se ven nehlásí:
     prohlížeči do něj nic není a chybová hláška zvenčí by mohla
     prozradit něco o vnitřním systému. */
  const status = mail.status === 'fulfilled' ? mail.value : 502;
  return res.status(status).json({ ok: status === 200 });
}
