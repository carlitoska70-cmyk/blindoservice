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
  // Fake Kassaro OS centrale on loopback: signal (POST) and evidence (GET).
  const kassaro = `http://127.0.0.1:${process.env.E2E_HOLDING_PORT}`;
  const evidence = {
    fonte: 'Kassaro OS',
    versione: '8.3.0',
    generato: new Date().toISOString(),
    base: kassaro,
    riepilogo: { presenti: 1, parziali: 0, assenti: 0 },
    voci: [
      {
        categoria: 'HACCP',
        catalogo: 'Manuale o piano di autocontrollo',
        stato: 'presente',
        dettaglio: 'Manuale HACCP E2E, versione 3',
        ultimo: rome(-2),
        sezione: '/#/haccp',
      },
    ],
    pagina_controlli: { attiva: true, url: `${kassaro}/controllo/e2e-token`, scade: null },
  };
  const received: { auth?: string; body: any }[] = [];
  const evidenceReads: (string | undefined)[] = [];
  const centrale = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/holding/evidenze') {
      evidenceReads.push(req.headers.authorization);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(evidence));
      return;
    }
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

    // Evidence: read with the same key before the signal, saved, counted in da_completare.
    expect(evidenceReads).toEqual([`Bearer ${process.env.E2E_HOLDING_KEY}`]);
    const gaps = body.dati.da_completare;
    expect(gaps.evidenze_gestionale).toEqual(
      expect.objectContaining({ presenti: 1, parziali: 0, assenti: 0 }),
    );
    expect(gaps.elenchi.requisiti_coperti_da_valutare).toContainEqual({
      titolo: 'Manuale o piano di autocontrollo',
      evidenza: 'presente',
    });
    expect(gaps.elenchi.documenti_da_verificare).toEqual(
      expect.arrayContaining(['SCIA E2E holding', 'Agibilità E2E holding']),
    );
    expect(gaps.profilo.mancanti).toContain('Informativa del portale');
    expect(raw).not.toContain('e2e-token');

    // The site keeps working after the cron ran, and the catalogue shows the evidence.
    const state = await (await page.request.get('/api/state')).json();
    expect(state.records.filter((r: any) => r.kind === 'evidence')).toHaveLength(1);
    await page.reload();
    await page.getByRole('tab', { name: 'Catalogo' }).click();
    await page
      .getByPlaceholder('Es. allergeni, agibilità, gas, verbale…')
      .fill('Manuale o piano di autocontrollo');
    const line = page.locator('.catalog-evidence').first();
    await expect(line).toContainText('Dal gestionale Kassaro OS: Manuale HACCP E2E, versione 3');
    await expect(line.getByRole('link', { name: /Apri nel gestionale/ })).toHaveAttribute(
      'href',
      `${kassaro}/#/haccp`,
    );
  } finally {
    centrale.close();
  }
});

test('portale: il link ai registri HACCP del gestionale solo al controllore autorizzato', async ({
  page,
  browser,
  baseURL,
}) => {
  // Runs after the test above, which saved the evidence with an active HACCP page.
  await login(page);
  const owner = (path: string, data: object) =>
    page.request.post(path, { headers: { origin: baseURL! }, data });
  const profile = {
    name: 'Bar E2E',
    legalName: 'Bar E2E srl',
    vat: '',
    address: '',
    city: 'Palermo',
    region: 'Sicilia',
    activity: 'Bar',
    staff: 'Sì',
    dehors: 'No',
    reviewer: '',
    portalNotice: 'Informativa di prova per il collaudo del portale. '.repeat(4),
  };
  expect((await owner('/api/state', { action: 'profile', data: profile })).ok()).toBeTruthy();
  expect((await owner('/api/control-room', { action: 'portal', enabled: true })).ok()).toBeTruthy();
  try {
    const portal = (await (await page.request.get('/api/control-room')).json()).portal.id;
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto('/accesso');
    const call = (action: string, data: object = {}) =>
      visitor.evaluate(
        async ([portal, action, data]) => {
          const r = await fetch('/api/portal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portal, action, ...(data as object) }),
          });
          return r.status;
        },
        [portal, action, data] as const,
      );
    const read = (): Promise<any> =>
      visitor.evaluate(async portal => (await fetch('/api/portal?portal=' + portal)).json(), portal);
    await call('start');
    expect(
      await call('identify', {
        data: {
          firstName: 'Mario',
          lastName: 'Verifica',
          office: 'ASP E2E',
          role: 'Tecnico',
          plate: '',
          purpose: 'Verifica HACCP',
          noticeRead: true,
        },
      }),
    ).toBe(200);
    expect((await read()).haccp).toBeNull();

    const visits = (await (await page.request.get('/api/control-room')).json()).visits;
    const visit = visits.find((v: any) => v.status === 'in_attesa');
    expect(
      (
        await owner('/api/control-room', {
          action: 'grants',
          visitId: visit.id,
          documentIds: [],
          identityVerified: true,
        })
      ).ok(),
    ).toBeTruthy();
    expect((await read()).haccp).toEqual({
      url: `http://127.0.0.1:${process.env.E2E_HOLDING_PORT}/controllo/e2e-token`,
      scade: null,
    });
    await visitor.reload();
    await expect(visitor.getByRole('link', { name: 'Apri i registri HACCP' })).toHaveAttribute(
      'href',
      `http://127.0.0.1:${process.env.E2E_HOLDING_PORT}/controllo/e2e-token`,
    );
    await owner('/api/control-room', { action: 'revoke', visitId: visit.id });
  } finally {
    await owner('/api/control-room', { action: 'portal', enabled: false });
  }
});
