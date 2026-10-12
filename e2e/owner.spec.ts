import { expect, test } from '@playwright/test';
import { login, openTab } from './helpers';

test('login rifiuta credenziali errate e accetta quelle corrette', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.E2E_OWNER_EMAIL!);
  await page.getByLabel('Password').fill('x'.repeat(43));
  await page.getByRole('button', { name: 'Entra nell’archivio' }).click();
  await expect(page.getByRole('alert')).toContainText('non corrette');
  await login(page);
  await expect(page.getByRole('tab', { name: 'Controlli' })).toBeVisible();
});

test('API private chiuse senza sessione', async ({ request }) => {
  expect((await request.get('/api/state')).status()).toBe(401);
  expect((await request.get('/api/control-room')).status()).toBe(401);
});

test('controllo: fascicolo, annotazione, PDF', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Avvia un controllo' }).click();
  await page.getByPlaceholder('Es. ASP, Polizia municipale, Ispettorato…').fill('ASP E2E');
  await page.getByLabel('Oggetto dichiarato del controllo *').fill('Verifica end-to-end');
  await page.getByRole('button', { name: 'Salva' }).click();
  await expect(page.getByRole('heading', { name: 'La postazione' })).toBeVisible();
  await page.getByPlaceholder(/agibilità/).fill('Ci mostri il piano HACCP');
  await page.getByRole('button', { name: 'Aggiungi alla cronologia' }).click();
  await expect(page.locator('.timeline')).toContainText('Ci mostri il piano HACCP');
  const pdf = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'PDF' }).click();
  const report = await pdf;
  await expect(report.getByRole('heading', { name: 'ASP E2E' })).toBeVisible();
  await expect(report.locator('table')).toContainText('Ci mostri il piano HACCP');
});

test('azioni: crea, completa, archivia e ripristina', async ({ page }) => {
  await login(page);
  await openTab(page, 'Azioni');
  await page.getByRole('button', { name: 'Nuova azione' }).click();
  await page.getByLabel('Che cosa occorre fare? *').fill('Reperire planimetria E2E');
  await page.getByRole('button', { name: 'Salva' }).click();
  const task = page.locator('.task', { hasText: 'Reperire planimetria E2E' });
  await task.getByRole('checkbox').click();
  await expect(task.getByText('Completata')).toBeVisible();
  await task.getByRole('button', { name: 'Modifica' }).click();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Archivia' }).click();
  await expect(task).toHaveCount(0);
  await openTab(page, 'Azienda');
  const row = page.locator('.archivedrow', { hasText: 'Reperire planimetria E2E' });
  await row.getByRole('button', { name: 'Ripristina' }).click();
  await expect(row).toHaveCount(0);
  await openTab(page, 'Azioni');
  await expect(page.locator('.task', { hasText: 'Reperire planimetria E2E' })).toBeVisible();
});

test('portale QR: attivazione e modulo del visitatore', async ({ page, browser }) => {
  await login(page);
  // Activation requires the privacy notice for visitors (at least 120 characters).
  await openTab(page, 'Azienda');
  await page
    .getByLabel('Informativa per il portale dei controlli')
    .fill('Informativa di prova per il collaudo. '.repeat(5));
  await page.getByRole('button', { name: 'Salva profilo' }).click();
  await expect(page.getByText('Profilo aziendale aggiornato')).toBeVisible();
  await openTab(page, 'Accessi QR');
  await expect(page.locator('.qrlive svg')).toBeVisible();
  await page.getByRole('button', { name: 'Attiva portale' }).click();
  await expect(page.getByText('QR attivo')).toBeVisible();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/accesso');
  await expect(visitor.getByText(/nome/i).first()).toBeVisible();
  await expect(visitor.getByText('Il portale non è attivo')).toHaveCount(0);
  await page.getByRole('button', { name: 'Disattiva portale' }).click();
  await expect(page.getByText('QR disattivato')).toBeVisible();
});

test('pagina offline in cache senza redirect', async ({ page }) => {
  await login(page);
  const result = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // Same asset handling as Cloudflare: the server redirects /offline.html to /offline.
    const direct = await fetch('/offline.html', { redirect: 'manual' });
    let cached: Response | undefined;
    for (let i = 0; i < 20 && !cached; i++) {
      cached = await caches.match('/offline.html');
      if (!cached) await new Promise(r => setTimeout(r, 250));
    }
    return {
      serverRedirects: direct.type === 'opaqueredirect',
      cached: !!cached,
      redirected: cached?.redirected,
      status: cached?.status,
      text: (await cached?.text())?.includes('Sei offline'),
    };
  });
  // A redirected response cannot answer a navigation: the worker must store a clean copy.
  expect(result).toEqual({ serverRedirects: true, cached: true, redirected: false, status: 200, text: true });
});
