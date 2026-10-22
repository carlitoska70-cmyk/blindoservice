import { expect, test } from '@playwright/test';
import { login } from './helpers';

const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';

test('controllo completo: QR con esibizione automatica, monitor, suggerimenti, rapporto PDF', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await login(page);
  // Owner setup: privacy notice, one exhibitable document, automatic exhibition on, portal on.
  await page.evaluate(async pdf => {
    const post = (body: unknown) =>
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const state: any = await (await fetch('/api/state')).json();
    await post({
      action: 'profile',
      data: { ...state.profile, portalNotice: 'Informativa di prova per il collaudo. '.repeat(5) },
    });
    const form = new FormData();
    form.append('file', new File([pdf], 'scia.pdf', { type: 'application/pdf' }));
    const up: any = await (await fetch('/api/files', { method: 'POST', body: form })).json();
    await post({
      action: 'create',
      kind: 'document',
      data: {
        title: 'SCIA di apertura',
        category: 'Titoli e SCIA',
        expires: '',
        issued: '',
        vat: '',
        address: '',
        notes: 'nota interna riservata',
        fileId: up.id,
        fileName: up.name,
        reviewed: false,
        reviewer: '',
        protocol: '',
        autoShare: true,
      },
    });
    const room = (body: unknown) =>
      fetch('/api/control-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    await room({ action: 'settings', autoShare: true });
    await room({ action: 'portal', enabled: true });
  }, PDF);

  // Inspector: scans the QR, identifies, searches with a synonym and opens the document.
  const agent = await (await browser.newContext()).newPage();
  await agent.goto('/accesso');
  await agent.getByLabel('Nome *', { exact: true }).fill('Mario');
  await agent.getByLabel('Cognome *').fill('Rossi');
  await agent.getByLabel('Ente e ufficio di provenienza *').fill('Polizia municipale di Palermo');
  await agent.getByLabel('Ho letto le informazioni sulla sessione.').check();
  await agent.getByRole('button', { name: 'Accedi ai documenti' }).click();
  await expect(agent.getByRole('heading', { name: 'Quale documento cerca?' })).toBeVisible();
  await agent.getByLabel('Documento da cercare').fill('segnalazione certificata');
  await agent.getByRole('button', { name: 'Cerca' }).click();
  await agent.locator('.documentcard', { hasText: 'SCIA di apertura' }).click();
  await expect(agent.getByRole('dialog', { name: 'SCIA di apertura' })).toBeVisible();
  await expect(agent.getByText('nota interna riservata')).toHaveCount(0);

  // Owner: the app shows "Monitora controllo in corso".
  await page.reload();
  const cta = page.getByRole('button', { name: /Monitora controllo in corso/ });
  await expect(cta).toBeVisible({ timeout: 15_000 });
  await expect(cta).toContainText('Mario Rossi');
  await cta.click();
  const monitor = page.getByRole('dialog', { name: 'Monitora controllo in corso' });
  await expect(monitor).toBeVisible();
  await expect(monitor.getByText('Sta guardando:')).toContainText('SCIA di apertura', { timeout: 15_000 });
  await expect(monitor.frameLocator('iframe').locator('body')).toBeAttached();
  // A live suggestion arrives from the recorded segments.
  await expect(monitor.locator('.hinta')).toBeVisible({ timeout: 40_000 });
  await expect(monitor.locator('.hinta')).toContainText('la SCIA è nel portale');
  // Let the next segment (the threat) be transcribed before ending.
  await expect(monitor.locator('.transcripttail')).toContainText('chiudo il locale', { timeout: 30_000 });

  // End: recording archived, report and PDF ready, portal session closed.
  page.once('dialog', d => d.accept());
  await monitor.getByRole('button', { name: 'Termina controllo' }).click();
  await expect(monitor.getByRole('heading', { name: 'Controllo terminato' })).toBeVisible({
    timeout: 60_000,
  });
  const pdfLink = monitor.getByRole('link', { name: 'Apri il PDF del rapporto' });
  await expect(pdfLink).toBeVisible();
  const href = await pdfLink.getAttribute('href');
  const pdf = await page.request.get(href!);
  expect((await pdf.body()).subarray(0, 8).toString()).toBe('%PDF-1.4');
  const report = await page.request.get('/api/state');
  const records = (await report.json()).records;
  const r = records.find((x: any) => x.kind === 'report');
  expect(r.data.possibiliViolazioni[0].citazione).toBe('le chiudo il locale oggi stesso');
  expect(records.some((x: any) => x.kind === 'event' && x.data.tag === 'Registrazione')).toBe(true);
  // The inspector's page notices the closed session at its next refresh.
  await expect(agent.getByRole('heading', { name: 'Sessione conclusa' })).toBeVisible({ timeout: 15_000 });
  await monitor.getByRole('button', { name: 'Chiudi' }).click();
});

test.afterEach(async ({ page }) => {
  // Leave the shared e2e database as other tests expect it: portal and auto exhibition off.
  await page.goto('/');
  await page.evaluate(async () => {
    const room = (body: unknown) =>
      fetch('/api/control-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    await room({ action: 'settings', autoShare: false });
    await room({ action: 'portal', enabled: false });
  });
});
