'use client';
// Documents the owner explicitly saved for offline use (Cache API + a title index).
// Stored only on this device; cleared on logout.
const CACHE = 'presidio-offline-docs';
const INDEX = 'presidio-offline-index';
const url = (fileId: string) => '/api/files?id=' + encodeURIComponent(fileId);

function readIndex(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(INDEX) || '{}');
  } catch {
    return {};
  }
}
function writeIndex(index: Record<string, string>) {
  try {
    localStorage.setItem(INDEX, JSON.stringify(index));
  } catch {}
}
export const offlineSupported = () => typeof window !== 'undefined' && 'caches' in window;

export async function offlineIds() {
  if (!offlineSupported()) return new Set<string>();
  const keys = await (await caches.open(CACHE)).keys();
  return new Set(keys.map(k => new URL(k.url).searchParams.get('id') || ''));
}
export async function saveOffline(fileId: string, title: string) {
  const res = await fetch(url(fileId), { cache: 'no-store' });
  if (!res.ok) throw new Error('Originale non disponibile');
  await (await caches.open(CACHE)).put(url(fileId), res);
  writeIndex({ ...readIndex(), [fileId]: title });
}
export async function removeOffline(fileId: string) {
  await (await caches.open(CACHE)).delete(url(fileId));
  const index = readIndex();
  delete index[fileId];
  writeIndex(index);
}
export async function clearOffline() {
  if (offlineSupported()) await caches.delete(CACHE);
  try {
    localStorage.removeItem(INDEX);
  } catch {}
}
