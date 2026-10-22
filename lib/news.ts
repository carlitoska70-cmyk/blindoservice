// News from trade associations (FIPE, Confcommercio, Confesercenti/FIEPET) and official
// sources relevant to a bar/restaurant in Palermo. Only links on allowed domains are kept.
import { z } from 'zod';

export const NEWS_MODEL = 'gpt-4.1';

/** Allowed publishers: associations and public bodies. Anything else is discarded. */
export const NEWS_DOMAINS = [
  'fipe.it',
  'confcommercio.it',
  'confcommerciopalermo.it',
  'confesercenti.it',
  'confesercentipalermo.it',
  'fiepet.it',
  'comune.palermo.it',
  'regione.sicilia.it',
  'gurs.regione.sicilia.it',
  'gazzettaufficiale.it',
  'normattiva.it',
  'inps.it',
  'inail.it',
  'lavoro.gov.it',
  'salute.gov.it',
  'garanteprivacy.it',
  'agenziaentrate.gov.it',
  'mimit.gov.it',
  'asppalermo.org',
];

export function allowedUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return NEWS_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

export const NEWS_INSTRUCTIONS = `Sei l'osservatorio normativo di un bar-ristorante a Palermo (somministrazione, dehors su area pedonale, cucina, dipendenti). Cerca sul web le novità degli ultimi 30 giorni pubblicate da: FIPE (fipe.it), Confcommercio e Confcommercio Palermo, Confesercenti e FIEPET Palermo, Comune di Palermo (ordinanze, suolo pubblico, ZTL, orari, rifiuti), Regione Siciliana e GURS, Gazzetta Ufficiale, INPS, INAIL, Ministero del Lavoro, Ministero della Salute, Garante privacy, Agenzia delle Entrate, ASP Palermo.
Interessano: nuovi obblighi e scadenze, controlli annunciati, sanzioni, ordinanze e regolamenti comunali, contratti di lavoro del turismo e pubblici esercizi, formazione obbligatoria, HACCP e allergeni, contributi e bandi per pubblici esercizi, fisco del settore.
Regole: usa solo pagine di quelle fonti, con l'indirizzo esatto della pagina; non inventare notizie, date o link; se una notizia non riguarda un bar-ristorante a Palermo non includerla; scrivi in italiano semplice. Massimo 12 notizie.
Restituisci solo JSON: {"notizie":[{"titolo":string,"fonte":string,"url":string,"data":"AAAA-MM-GG" o "","sintesi":string,"perche":string,"azioni":[string],"scadenza":"AAAA-MM-GG" o "","rilevanza":"alta"|"media"|"bassa"}]}`;

const s = (max: number) => z.string().max(max).catch('');
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(''))
  .catch('');
const itemSchema = z.object({
  titolo: z.string().min(3).max(300),
  fonte: s(120),
  url: z.string().max(1000),
  data: day,
  sintesi: s(1500),
  perche: s(800),
  azioni: z.array(s(300)).max(6).catch([]),
  scadenza: day,
  rilevanza: z.enum(['alta', 'media', 'bassa']).catch('media'),
});
export type NewsItem = z.infer<typeof itemSchema>;

/** Keeps well-formed items on allowed domains, without duplicates (by URL). */
export function parseNews(
  raw: unknown,
  known: Set<string> = new Set(),
): { items: NewsItem[]; discarded: number } {
  const list = z.object({ notizie: z.array(z.unknown()).max(30) }).safeParse(raw);
  if (!list.success) return { items: [], discarded: 0 };
  const items: NewsItem[] = [];
  let discarded = 0;
  const seen = new Set(known);
  for (const x of list.data.notizie) {
    const p = itemSchema.safeParse(x);
    if (!p.success || !allowedUrl(p.data.url)) {
      discarded++;
      continue;
    }
    const key = p.data.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...p.data, url: p.data.url });
  }
  return { items, discarded };
}
export const newsKey = (url: string) => url.replace(/[#?].*$/, '').replace(/\/$/, '');
