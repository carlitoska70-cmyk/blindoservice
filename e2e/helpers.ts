import { expect, type Page } from '@playwright/test';

export async function login(page: Page, who: 'OWNER' | 'STAFF' = 'OWNER') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env[`E2E_${who}_EMAIL`]!);
  await page.getByLabel('Password').fill(process.env[`E2E_${who}_PASSWORD`]!);
  await page.getByRole('button', { name: 'Entra nell’archivio' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Apertura del tuo archivio…')).toBeHidden();
}

export async function openTab(page: Page, name: string) {
  await page.getByRole('tab', { name }).click();
}
