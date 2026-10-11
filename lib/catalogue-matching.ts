export type MatchItem = {
  id: string;
  title: string;
  aliases?: string[];
  basis?: string;
  area?: string;
  category?: string;
  description?: string;
  condition?: string;
};
export function normalized(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
export function catalogLinks(data: any): string[] {
  return [
    ...new Set(
      [data?.catalogId, ...(Array.isArray(data?.catalogIds) ? data.catalogIds : [])].filter(
        (s): s is string => typeof s === 'string' && !!s.trim(),
      ),
    ),
  ];
}
export function withCatalogLinks(data: any, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length > 20) throw new Error('Massimo 20 voci per documento.');
  return { ...data, catalogId: unique[0] || '', catalogIds: unique };
}
const stop = new Set([
  'di',
  'del',
  'della',
  'delle',
  'dei',
  'degli',
  'e',
  'ed',
  'il',
  'lo',
  'la',
  'le',
  'gli',
  'a',
  'al',
  'alla',
  'alle',
  'per',
  'da',
  'in',
  'con',
  'sul',
  'sulla',
  'un',
  'una',
  'documento',
  'documenti',
]);
const words = (text: string) =>
  normalized(text)
    .split(' ')
    .filter(w => w && !stop.has(w));
const contains = (text: string, phrase: string) => (' ' + text + ' ').includes(' ' + phrase + ' ');
export function catalogueMatches(data: any, items: MatchItem[]) {
  if (data?.recognition?.quality === 'illeggibile') return [];
  // Never infer a document's content from its filename, category or free-form notes.
  const title = words(data?.title || '').join(' '),
    type = words(data?.documentType || '').join(' ');
  const description = words(data?.publicDescription || '').join(' ');
  return items
    .filter(i => i.basis !== 'Da approfondire')
    .map(item => {
      const phrases = [item.title, ...(item.aliases || [])].map(p => words(p).join(' ')).filter(Boolean);
      let score = 0,
        reason = '';
      for (const phrase of phrases) {
        const length = phrase.split(' ').length;
        for (const [text, weight] of [
          [type, 100],
          [title, 90],
          [description, 45],
        ] as const) {
          if (!text) continue;
          const exact = contains(text, phrase);
          // A single generic word must be a whole title/type, not just occur in a description.
          const valid = exact && (length > 1 || text === phrase || phrase.length <= 5);
          const uncertain =
            /\b(non disponibile|mancante|assenza)\b/.test(text) ||
            (/^(richiesta|preventivo|bozza|modello|fac simile)\b/.test(text) &&
              !phrase.startsWith(text.split(' ')[0]));
          const value = valid
            ? Math.min(weight, uncertain ? 45 : 100)
            : length > 1
              ? Math.round((phrase.split(' ').filter(w => contains(text, w)).length / length) * 30)
              : 0;
          if (value > score) {
            score = value;
            reason = valid ? 'Corrispondenza con «' + phrase + '»' : 'Parole del titolo da confrontare';
          }
        }
      }
      return { id: item.id, title: item.title, score, reason };
    })
    .filter(m => m.score >= 25)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
export function automaticCatalogueProposal(data: any, items: MatchItem[]) {
  if (catalogLinks(data).length || data.catalogMatchingDismissed) return data;
  const matches = catalogueMatches(data, items),
    best = matches[0];
  if (!best || best.score < 90 || (matches[1] && best.score - matches[1].score < 20)) return data;
  return { ...withCatalogLinks(data, [best.id]), catalogProposal: best.id };
}
export function documentIssues(
  data: any,
  profile: any = {},
  today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }),
) {
  const issues: string[] = [];
  if (!data.fileId) issues.push('Originale assente');
  if (!data.reviewed || !String(data.reviewer || '').trim()) issues.push('Verifica umana da annotare');
  if (data.expires && data.expires < today) issues.push('Data di scadenza superata');
  if (data.issued && data.issued > today) issues.push('Data di rilascio futura');
  if (data.expires && data.issued && data.expires < data.issued) issues.push('Date da correggere');
  const vat = (v: unknown) => normalized(v).replace(/^it/, '').replace(/ /g, '');
  if (vat(profile.vat) && vat(data.vat) && vat(profile.vat) !== vat(data.vat))
    issues.push('Partita IVA diversa dal profilo');
  if (profile.address && data.address && normalized(profile.address) !== normalized(data.address))
    issues.push('Sede da confrontare con il profilo');
  if (data.recognition?.quality === 'illeggibile') issues.push('Lettura automatica non riuscita');
  return issues;
}
export function itemStatus(item: MatchItem, records: any[], profile: any = {}) {
  const docs = records.filter(r => r.kind === 'document' && catalogLinks(r.data).includes(item.id));
  const assessments = records
    .filter(r => r.kind === 'requirement' && r.data.catalogId === item.id)
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  const assessment = assessments[0],
    applicability = assessment?.data.status || 'Da valutare';
  const files = docs.filter(r => r.data.fileId),
    issues = docs.flatMap(r => documentIssues(r.data, profile));
  const state =
    applicability === 'Non applicabile'
      ? 'Escluso dal responsabile'
      : applicability === 'Applicabile' && !files.length
        ? 'Originale da reperire'
        : !files.length
          ? 'Senza originale'
          : issues.length
            ? 'Da riesaminare'
            : 'File presenti';
  return { docs, files, assessment, applicability, issues, state };
}
export function prepareCatalogLink(data: any, id: string, add: boolean) {
  const ids = catalogLinks(data);
  return withCatalogLinks(data, add ? [...ids, id] : ids.filter(x => x !== id));
}
