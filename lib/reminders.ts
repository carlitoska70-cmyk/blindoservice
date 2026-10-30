// Expiry and overdue reminders. Pure functions: the route supplies records and "today".

export type ReminderRecord = { id: string; kind: string; data: any };
export type DueItem = {
  id: string;
  kind: 'document' | 'task';
  title: string;
  date: string;
  days: number;
};

/** Days that trigger a document reminder, so a daily run does not repeat the same item. */
export const DOCUMENT_MILESTONES = [30, 7, 1, 0];

/** Today's date (YYYY-MM-DD) in Italy, where the business operates. */
export const romeToday = (now = new Date()) => now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

function daysBetween(today: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
}

/** Everything that needs attention now: documents within 30 days or past, open tasks due or late. */
export function dueItems(records: ReminderRecord[], today: string): DueItem[] {
  const items: DueItem[] = [];
  for (const r of records) {
    if (r.data?.archivedAt) continue;
    if (r.kind === 'document') {
      const days = daysBetween(today, r.data.expires);
      if (days !== null && days <= 30)
        items.push({ id: r.id, kind: 'document', title: r.data.title, date: r.data.expires, days });
    } else if (r.kind === 'task' && !r.data.done) {
      const days = daysBetween(today, r.data.due);
      if (days !== null && days <= 7)
        items.push({ id: r.id, kind: 'task', title: r.data.title, date: r.data.due, days });
    }
  }
  return items.sort((a, b) => a.days - b.days);
}

/**
 * Items worth a push notification today: documents on a milestone day, anything overdue
 * on Mondays (weekly nudge), tasks due today or tomorrow.
 */
export function notifiable(items: DueItem[], today: string) {
  const monday = new Date(today + 'T12:00:00Z').getUTCDay() === 1;
  return items.filter(x =>
    x.days < 0 ? monday : x.kind === 'document' ? DOCUMENT_MILESTONES.includes(x.days) : x.days <= 1,
  );
}

export const when = (days: number) =>
  days < 0
    ? `scaduto da ${-days} ${days === -1 ? 'giorno' : 'giorni'}`
    : days === 0
      ? 'oggi'
      : days === 1
        ? 'domani'
        : `tra ${days} giorni`;

export function reminderText(business: string, items: DueItem[], appUrl: string) {
  const docs = items.filter(x => x.kind === 'document');
  const tasks = items.filter(x => x.kind === 'task');
  const lines = [`Blindo Service · ${business}`, ''];
  if (docs.length) {
    lines.push('Date da riesaminare:');
    for (const x of docs) lines.push(`• ${x.title} — ${when(x.days)} (${x.date})`);
    lines.push('');
  }
  if (tasks.length) {
    lines.push('Azioni:');
    for (const x of tasks) lines.push(`• ${x.title} — ${when(x.days)} (${x.date})`);
    lines.push('');
  }
  lines.push(`Apri l’archivio: ${appUrl}`);
  lines.push('Le date sono quelle inserite nelle schede: verificale sugli originali.');
  return lines.join('\n');
}
