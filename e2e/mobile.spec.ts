import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('mobile: barra inferiore e menu Altro', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Sezioni' });
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('dialog', { name: 'Altre sezioni' }).getByRole('button', { name: 'Azienda' }).click();
  await expect(page.getByRole('heading', { name: 'La tua azienda' })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
