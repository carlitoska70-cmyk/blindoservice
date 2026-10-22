import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const rome = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const document = (title: string, expires: string) => ({
  title,
  category: 'Altro',
  expires,
  issued: '',
  vat: '',
  address: '',
  notes: '',
  fileId: '',
  fileName: '',
  reviewed: false,
  reviewer: '',
  protocol: '',
});

test('holding: il segnale orario porta scadenze e controlli alla centrale, senza dati dei controllori', async ({
  page,
  baseURL,
}) => {
  // Fake Kassaro OS centrale on loopback.
  const received: { auth?: string; body: any }[] = [];
  const centrale = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  });
  await new Promise<void>(done => centrale.listen(Number(process.env.E2E_HOLDING_PORT), '127.0.0.1', done));
  try {
    await login(page);
    const save = (kind: string, data: object) =>
      page.request.post('/api/state', {
        headers: { origin: baseURL! },
        data: { action: 'create', kind, data },
      });
    expect((await save('document', document('SCIA E2E holding', rome(10)))).ok()).toBeTruthy();
    expect((await save('document', document('Agibilità E2E holding', rome(-3)))).ok()).toBeTruthy();
    const inspection = {
      authority: 'NAS E2E',
      scope: 'Verifica holding',
      officers: 'Brigadiere Esposito Gennaro, targa ZZ999ZZ',
      reference: 'Prot. 31337',
      status: 'aperto',
      outcome: '',
      started: new Date().toISOString(),
      ended: '',
    };
    expect((await save('inspection', inspection)).ok()).toBeTruthy();

    expect((await page.request.get('/cdn-cgi/handler/scheduled?cron=7+*+*+*+*')).ok()).toBeTruthy();
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(1);

    const [{ auth, body }] = received;
    expect(auth).toBe(`Bearer ${process.env.E2E_HOLDING_KEY}`);
    expect(Object.keys(body)).toEqual(['stato', 'testo', 'dati']);
    expect(body.stato).toBe('attenzione');
    expect(body.testo).toMatch(/document[oi] scadut[oi] · \d+ in scadenza entro 30 giorni · \d+ controll/);
    expect(body.dati.documenti_in_scadenza).toContainEqual({
      titolo: 'SCIA E2E holding',
      scade_il: rome(10),
      tra_giorni: 10,
    });
    expect(body.dati.documenti_scaduti).toContainEqual({
      titolo: 'Agibilità E2E holding',
      scaduto_il: rome(-3),
      da_giorni: 3,
    });
    expect(body.dati.controlli_elenco).toContainEqual(
      expect.objectContaining({ ente: 'NAS E2E', oggetto: 'Verifica holding', stato: 'aperto' }),
    );
    expect(body.dati.portale_qr).toEqual({ attivo: false });
    expect(body.dati.versione).toMatch(/^\d+\.\d+\.\d+$/);
    const raw = JSON.stringify(body);
    expect(raw.length).toBeLessThanOrEqual(16_384);
    for (const hidden of ['Esposito', 'ZZ999ZZ', '31337', process.env.E2E_HOLDING_KEY!])
      expect(raw).not.toContain(hidden);

    // The site keeps working after the cron ran.
    expect((await page.request.get('/api/state')).ok()).toBeTruthy();
  } finally {
    centrale.close();
  }
});
