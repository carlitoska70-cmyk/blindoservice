import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('collaboratore: niente controlli, QR e postazione', async ({ page }) => {
  await login(page, 'STAFF');
  await expect(page.getByText('Accesso collaboratore')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Documenti' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Controlli' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Accessi QR' })).toHaveCount(0);
  expect((await page.request.get('/api/control-room')).status()).toBe(401);
  await page.goto('/fascicolo?id=x');
  await expect(page).toHaveURL(/\/$/);
});
