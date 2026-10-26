// The holding link at the moment it matters most: an inspector has just identified at the portal.
// Blindo sends its full signal at once with an «allerta», and Gionti Holding rings Carlo's phone.
// Office and declared subject only; names, qualifications and plates stay in Blindo.
import { allCatalogue } from './catalogue-index';
import { sendHolding } from './holding';
import { staffSummary } from './staff';
import { VERSION } from './version';

type Env = { DB?: D1Database; HOLDING_SEGNALE_KEY?: string; HOLDING_URL?: string };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const catalogue = allCatalogue.map(c => ({ id: c.id, title: c.title }));
/** The inspector is waiting at the door: do not keep the portal hanging on a slow centrale. */
const ALERT_TIMEOUT_MS = 8_000;

export function alertInspection(
  env: Env,
  a: { visitId: string; office: string; purpose: string; origin: string },
  fetchImpl: Fetch = fetch,
  now = new Date(),
) {
  return sendHolding(
    env,
    {
      version: VERSION,
      now,
      staffSummary,
      allerta: {
        tipo: 'controllo',
        id: a.visitId,
        ente: a.office,
        motivo: a.purpose,
        ora: now.toISOString(),
        link: a.origin + '/',
      },
    },
    fetchImpl,
    catalogue,
    ALERT_TIMEOUT_MS,
  ).catch(() => ({ sent: false, reason: 'Avviso alla holding non riuscito' }));
}
