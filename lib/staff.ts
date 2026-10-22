// Documents each employee should have on file, matched against the archive.
// Generic checklist for a bar/restaurant in Sicily: final requirements depend on
// contract, DVR and role, so missing items are "to check", not violations.
import type { DocumentData, EmployeeData } from './schemas';

type Doc = { id: string; data: DocumentData };
export type StaffStatus = 'ok' | 'in_scadenza' | 'scaduto' | 'mancante';
export type StaffItem = { key: string; label: string; hint: string; status: StaffStatus; doc?: Doc };

type Rule = { key: string; label: string; hint: string; match: RegExp; when?: (e: EmployeeData) => boolean };

export const STAFF_RULES: Rule[] = [
  {
    key: 'contratto',
    label: 'Contratto o lettera di assunzione',
    hint: 'Lettera firmata o contratto individuale',
    match: /contratt|lettera (di )?ass|assunzion|trasform/i,
  },
  {
    key: 'unilav',
    label: 'Comunicazione UNILAV',
    hint: 'Comunicazione obbligatoria al Centro per l’impiego',
    match: /unilav|uniurg|comunicazione obbligatoria/i,
  },
  {
    key: 'identita',
    label: 'Documento di identità',
    hint: 'Copia conservata dal datore di lavoro',
    match: /identit|\bcie\b|passaport|patente/i,
  },
  {
    key: 'codicefiscale',
    label: 'Codice fiscale / tessera sanitaria',
    hint: 'Copia',
    match: /codice fiscale|tessera sanitaria/i,
  },
  {
    key: 'permesso',
    label: 'Permesso di soggiorno valido',
    hint: 'Lavoratore extra-UE: controllare la scadenza',
    match: /permesso di soggiorno|soggiorno|ricevuta (di )?rinnovo/i,
    when: e => e.extraUe,
  },
  {
    key: 'haccp',
    label: 'Attestato alimentarista (HACCP)',
    hint: 'Formazione per chi manipola alimenti',
    match: /haccp|alimentarist/i,
  },
  {
    key: 'sicurezza',
    label: 'Formazione sicurezza (art. 37 D.Lgs. 81/2008)',
    hint: 'Formazione generale e specifica',
    match: /art\.?\s?37|sicurezza|formazione generale|rischio basso/i,
  },
  {
    key: 'rls',
    label: 'Attestato RLS',
    hint: 'Rappresentante dei lavoratori per la sicurezza',
    match: /\brls\b/i,
    when: e => e.designations.includes('RLS'),
  },
  {
    key: 'preposto',
    label: 'Formazione preposto',
    hint: 'Art. 37 c.7 D.Lgs. 81/2008',
    match: /prepost/i,
    when: e => e.designations.includes('Preposto'),
  },
  {
    key: 'primosoccorso',
    label: 'Attestato primo soccorso',
    hint: 'Addetto designato',
    match: /primo soccorso/i,
    when: e => e.designations.includes('Addetto primo soccorso'),
  },
  {
    key: 'antincendio',
    label: 'Attestato antincendio',
    hint: 'Addetto designato',
    match: /antincendio/i,
    when: e => e.designations.includes('Addetto antincendio'),
  },
  {
    key: 'medico',
    label: 'Giudizio di idoneità (visita medica)',
    hint: 'Se la sorveglianza sanitaria è prevista dal DVR',
    match: /idoneit|visita medica|sorveglianza sanitaria|medico competente/i,
    when: e => e.medicalRequired,
  },
];

const text = (d: DocumentData) => [d.title, d.documentType, d.category, d.fileName].filter(Boolean).join(' ');

function dateStatus(expires: string | undefined, today: string): StaffStatus {
  if (!expires) return 'ok';
  const days = Math.round((Date.parse(expires + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  return days < 0 ? 'scaduto' : days <= 30 ? 'in_scadenza' : 'ok';
}

export function staffChecklist(
  employee: { id: string; data: EmployeeData },
  docs: Doc[],
  today: string,
): StaffItem[] {
  const mine = docs.filter(d => d.data.employeeId === employee.id && !d.data.archivedAt);
  return STAFF_RULES.filter(r => !r.when || r.when(employee.data)).map(r => {
    const candidates = mine
      .filter(d => r.match.test(text(d.data)))
      .sort((a, b) => (b.data.expires || '9999').localeCompare(a.data.expires || '9999'));
    const doc = candidates[0];
    return {
      key: r.key,
      label: r.label,
      hint: r.hint,
      status: doc ? dateStatus(doc.data.expires, today) : 'mancante',
      doc,
    };
  });
}

/** Contract end dates and missing items, for the overview and the holding. */
export function staffSummary(employees: { id: string; data: EmployeeData }[], docs: Doc[], today: string) {
  return employees
    .filter(e => e.data.active && !e.data.archivedAt)
    .map(e => {
      const items = staffChecklist(e, docs, today);
      return {
        id: e.id,
        name: e.data.name,
        role: e.data.role,
        missing: items.filter(i => i.status === 'mancante').map(i => i.label),
        expiring: items.filter(i => i.status === 'in_scadenza' || i.status === 'scaduto').map(i => i.label),
        contractEnd: e.data.endDate || '',
        complete: items.filter(i => i.status === 'ok').length,
        total: items.length,
      };
    });
}

// ── Retention after the end of employment (Blindo documento 10 «Conservazione») ──────────────
// Identity and tax-code copies: 12 months; residence permits: 6 years (proof of the checks,
// art. 22 c. 12 D.Lgs. 286/1998); everything else: 5 years (art. 2948 c.c.). The owner confirms
// every deletion: nothing about employees is deleted automatically.
export const STAFF_KEEP_MONTHS: Record<string, number> = { identita: 12, codicefiscale: 12, permesso: 72 };
export const STAFF_DEFAULT_MONTHS = 60;

const addMonths = (day: string, months: number) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** Former employee with an end date: the only case in which their file can be deleted. */
export const staffEnded = (e: EmployeeData) => !e.active && /^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '');

/** Day from which a document of a former employee can be deleted, or null while employed. */
export function staffDocUntil(employee: EmployeeData, doc: DocumentData) {
  if (!staffEnded(employee)) return null;
  const rule = STAFF_RULES.find(r => r.key in STAFF_KEEP_MONTHS && r.match.test(text(doc)));
  return {
    key: rule?.key || 'altro',
    until: addMonths(employee.endDate, rule ? STAFF_KEEP_MONTHS[rule.key] : STAFF_DEFAULT_MONTHS),
  };
}

/** Day from which the record of a former employee can be deleted (once no document is linked). */
export const staffRecordUntil = (employee: EmployeeData) =>
  staffEnded(employee) ? addMonths(employee.endDate, STAFF_DEFAULT_MONTHS) : null;

/** Identity papers, permits, payslips, medical certificates: filled in by hand, never sent to the AI. */
export const SENSITIVE_STAFF_DOC =
  /identit|\bcie\b|passaport|patente|permesso di soggiorno|ricevuta (di )?rinnovo|codice fiscale|tessera sanitaria|busta paga|cedolin|certificat\w* medic|malattia/i;
