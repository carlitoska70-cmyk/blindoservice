// Keyword search used by the inspector portal: accent-insensitive, with the
// words inspectors actually use for each document family.

export const normalize = (s: string) =>
  s
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Each group: any term finds documents containing any other term of the group. */
export const SYNONYMS: string[][] = [
  ['scia', 'segnalazione certificata', 'inizio attivita', 'suap', 'dia'],
  ['agibilita', 'abitabilita', 'agibile', 'certificato di agibilita', 'segnalazione certificata agibilita'],
  ['haccp', 'autocontrollo', 'manuale haccp', 'piano di autocontrollo', 'igiene'],
  ['sanitaria', 'notifica sanitaria', 'registrazione sanitaria', 'reg ce 852', '852 2004', 'asp'],
  ['planimetria', 'pianta', 'layout', 'piantina', 'disegno'],
  ['suolo pubblico', 'osp', 'occupazione suolo', 'dehors', 'tavolini', 'cosap', 'canone unico'],
  ['antincendio', 'cpi', 'vigili del fuoco', 'vvf', 'estintori', 'prevenzione incendi'],
  ['rifiuti', 'tari', 'raccolta differenziata', 'oli esausti', 'smaltimento'],
  ['insegna', 'pubblicita', 'impianto pubblicitario', 'cartellonistica'],
  ['musica', 'siae', 'scf', 'intrattenimento', 'diffusione sonora', 'impatto acustico', 'acustica'],
  ['alimentarista', 'attestato', 'formazione alimentaristi', 'corso haccp', 'libretto sanitario'],
  ['durc', 'regolarita contributiva', 'inps', 'inail'],
  ['visura', 'camera di commercio', 'cciaa', 'registro imprese', 'rea'],
  ['contratto', 'locazione', 'affitto', 'comodato', 'titolo di disponibilita'],
  ['impianto elettrico', 'dichiarazione di conformita', 'dico', 'di co', 'dm 37 2008', 'messa a terra'],
  ['gas', 'impianto gas', 'caldaia', 'canna fumaria', 'cappa', 'aspirazione fumi'],
  ['licenza', 'autorizzazione', 'somministrazione', 'titolo abilitativo', 'permesso'],
  ['alcolici', 'superalcolici', 'dogane', 'licenza fiscale', 'adm'],
  ['prezzi', 'listino', 'tabella prezzi', 'menu', 'allergeni'],
  ['lavoratori', 'dipendenti', 'assunzioni', 'unilav', 'libro unico', 'lul', 'contratti di lavoro'],
  ['sicurezza', 'dvr', 'valutazione dei rischi', 'rspp', 'primo soccorso', 'dlgs 81'],
  ['privacy', 'videosorveglianza', 'telecamere', 'gdpr', 'informativa'],
  ['acqua', 'potabilita', 'analisi acqua', 'legionella'],
  ['disinfestazione', 'derattizzazione', 'pest control', 'infestanti'],
  ['fiscale', 'registratore di cassa', 'rt', 'corrispettivi', 'partita iva'],
];

/** Terms to look for: the query plus every synonym of the groups it touches. */
export function expand(query: string) {
  const q = normalize(query);
  if (!q) return [];
  const terms = new Set([q]);
  for (const group of SYNONYMS) {
    const g = group.map(normalize);
    if (g.some(t => q.includes(t) || (t.includes(q) && q.length >= 3))) g.forEach(t => terms.add(t));
  }
  return [...terms];
}

export function matches(query: string, haystack: string) {
  const h = normalize(haystack);
  return expand(query).some(t => h.includes(t));
}
