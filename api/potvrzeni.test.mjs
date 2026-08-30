/* =========================================================================
   Testy endpointu /api/potvrzeni
   -------------------------------------------------------------------------
   Podstatná otázka: může předání do CRM jakkoli poškodit poptávku, kterou
   už Web3Forms úspěšně přijal? Nesmí. Ani selháním, ani zdržením, ani tím,
   že by se něco z vnitřku systému dostalo do odpovědi pro prohlížeč.

   Ke skutečnému Resendu ani CRM se nevolá — `fetch` je podstrčený.
   ========================================================================= */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import handler from './potvrzeni.mjs';

const RESEND = 'https://api.resend.com/emails';
const CRM = 'https://crm.md-therm.cz/api/poptavky';

const puvodniFetch = globalThis.fetch;
const puvodniEnv = { ...process.env };

/** Nejmenší náhrada za req/res, jakou handler potřebuje. */
function fakeReq(body, ip) {
  return { method: 'POST', headers: { 'x-forwarded-for': ip }, body };
}

function fakeRes() {
  const res = {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(k, v) { res.headers[k] = v; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.payload = payload; return res; }
  };
  return res;
}

const submission = (over = {}) => ({
  jmeno: 'Žofie Křížová',
  email: 'zofie@example.com',
  telefon: '600 700 800',
  telefonE164: '+420600700800',
  sluzba: 'Tepelné čerpadlo',
  objekt: 'Rodinný dům',
  situace: 'Novostavba',
  mesto: 'Žďár nad Sázavou',
  psc: '591 01',
  popis: 'Dům 140 m².',
  submissionId: '11111111-2222-4333-8444-555555555555',
  ...over
});

/** Každý test má vlastní IP, aby si testy nesahaly do počítadla požadavků. */
let ipCounter = 0;
const nextIp = () => '10.0.0.' + (++ipCounter);

/**
 * Podstrčí `fetch` pro obě služby zvlášť.
 * `crm` i `mail` jsou buď stavový kód, nebo funkce (pro výjimky a zdržení).
 */
function stubFetch({ mail = 200, crm = 201 } = {}) {
  const calls = { mail: [], crm: [] };
  globalThis.fetch = async (url, init) => {
    const target = String(url).startsWith(RESEND) ? 'mail' : 'crm';
    calls[target].push({ url, init });
    const behaviour = target === 'mail' ? mail : crm;
    if (typeof behaviour === 'function') return behaviour(url, init);
    return { status: behaviour, ok: behaviour >= 200 && behaviour < 300, json: async () => ({ id: 'x' }) };
  };
  return calls;
}

beforeEach(() => {
  process.env.RESEND_API_KEY = 'testovaci-klic-resend';
  process.env.MDT_LEAD_INGEST_SECRET = 'testovaci-tajemstvi-crm';
});

afterEach(() => {
  globalThis.fetch = puvodniFetch;
  process.env = { ...puvodniEnv };
});

describe('po úspěšném odeslání poptávky', () => {
  it('pošle potvrzení i kopii do CRM', async () => {
    const calls = stubFetch();
    const res = fakeRes();

    await handler(fakeReq(submission(), nextIp()), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { ok: true });
    assert.equal(calls.mail.length, 1);
    assert.equal(calls.crm.length, 1);

    const crmBody = JSON.parse(calls.crm[0].init.body);
    assert.equal(crmBody.name, 'Žofie Křížová');
    assert.equal(crmBody.phone, '600 700 800');
    assert.equal(crmBody.city, 'Žďár nad Sázavou');
    assert.equal(calls.crm[0].init.headers.Authorization, 'Bearer testovaci-tajemstvi-crm');
    assert.match(calls.crm[0].init.headers['Idempotency-Key'], /^web-[0-9a-f]{40}$/);
  });

  it('selhání CRM nezmění nic pro návštěvníka', async () => {
    for (const crm of [401, 400, 500]) {
      const calls = stubFetch({ crm });
      const res = fakeRes();

      await handler(fakeReq(submission(), nextIp()), res);

      assert.equal(res.statusCode, 200, 'CRM ' + crm + ' nesmí změnit odpověď');
      assert.deepEqual(res.payload, { ok: true });
      assert.equal(calls.mail.length, 1, 'potvrzovací e-mail se musí odeslat i tak');
    }
  });

  it('výpadek sítě do CRM nezhatí už přijatou poptávku', async () => {
    const calls = stubFetch({ crm: async () => { throw new TypeError('fetch failed'); } });
    const res = fakeRes();

    await handler(fakeReq(submission(), nextIp()), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { ok: true });
    assert.equal(calls.mail.length, 1);
  });

  it('nedostupné CRM neshodí potvrzení ani nevyhodí výjimku', async () => {
    const calls = stubFetch({
      crm: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
    });
    const res = fakeRes();

    // Timeout adaptéru je 5 s; test ho nečeká — stačí, že se nic nerozbije.
    const done = handler(fakeReq(submission(), nextIp()), res);
    await done;

    assert.equal(res.statusCode, 200);
    assert.equal(calls.mail.length, 1);
  });

  it('nenastavené CRM nezastaví potvrzovací e-mail', async () => {
    delete process.env.MDT_LEAD_INGEST_SECRET;
    const calls = stubFetch();
    const res = fakeRes();

    await handler(fakeReq(submission(), nextIp()), res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls.mail.length, 1);
    assert.equal(calls.crm.length, 0);
  });

  it('nenastavený Resend nezastaví předání do CRM', async () => {
    delete process.env.RESEND_API_KEY;
    const calls = stubFetch();
    const res = fakeRes();

    await handler(fakeReq(submission(), nextIp()), res);

    // Poptávka do CRM dorazí, i když potvrzení odeslat nejde.
    assert.equal(calls.crm.length, 1);
    assert.equal(calls.mail.length, 0);
    assert.equal(res.statusCode, 500);
  });
});

describe('co se nesmí dostat ven', () => {
  it('odpověď neobsahuje tajemství ani podrobnosti o CRM', async () => {
    stubFetch({
      crm: async () => ({
        status: 401,
        json: async () => ({ error: 'Nepovolený požadavek.' })
      })
    });
    const res = fakeRes();

    await handler(fakeReq(submission(), nextIp()), res);

    const serialized = JSON.stringify({ status: res.statusCode, body: res.payload, headers: res.headers });
    assert.equal(serialized.includes('testovaci-tajemstvi-crm'), false);
    assert.equal(serialized.includes('testovaci-klic-resend'), false);
    assert.equal(serialized.includes('Nepovolený požadavek'), false);
    assert.equal(serialized.includes('crm.md-therm.cz'), false);
    assert.deepEqual(res.payload, { ok: true });
  });

  it('honeypot ani cizí pole se do CRM nepředají', async () => {
    const calls = stubFetch();
    const res = fakeRes();

    await handler(
      fakeReq(submission({ web: 'robot', access_key: 'klic-web3forms', role: 'ADMIN' }), nextIp()),
      res
    );

    const crmBody = JSON.parse(calls.crm[0].init.body);
    assert.equal(Object.hasOwn(crmBody, 'web'), false);
    assert.equal(Object.hasOwn(crmBody, 'access_key'), false);
    assert.equal(Object.hasOwn(crmBody, 'role'), false);
  });

  it('neplatný e-mail se odmítne dřív, než se cokoli odešle', async () => {
    const calls = stubFetch();
    const res = fakeRes();

    await handler(fakeReq(submission({ email: 'tohle-neni-email' }), nextIp()), res);

    assert.equal(res.statusCode, 400);
    assert.equal(calls.mail.length, 0);
    assert.equal(calls.crm.length, 0);
  });

  it('jiná metoda než POST neudělá nic', async () => {
    const calls = stubFetch();
    const res = fakeRes();

    await handler({ method: 'GET', headers: {}, body: {} }, res);

    assert.equal(res.statusCode, 405);
    assert.equal(calls.crm.length, 0);
  });
});
