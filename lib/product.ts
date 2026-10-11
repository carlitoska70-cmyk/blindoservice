import { catalogueCategories } from './catalogue';
export const categories = [...new Set([...catalogueCategories, 'Verbali e comunicazioni', 'Altro'])];
export type Profile = {
  name: string;
  legalName: string;
  vat: string;
  address: string;
  city: string;
  region: string;
  activity: string;
  staff: string;
  dehors: string;
  reviewer: string;
  portalNotice?: string;
};
export const defaultProfile: Profile = {
  name: 'Caffè del Kassaro',
  legalName: '',
  vat: '',
  address: '',
  city: 'Palermo',
  region: 'Sicilia',
  activity: 'Bar e ristorazione',
  staff: 'Da confermare',
  dehors: 'Da confermare',
  reviewer: '',
  portalNotice: '',
};
/** A stored record. `D` narrows `data` with the shared schema types (lib/schemas.ts). */
export type Entry<D = any> = { id: string; kind: string; data: D; created: string; updated: string };
export const sources = [
  {
    title: 'Normattiva',
    scope: 'Italia · testi normativi',
    url: 'https://www.normattiva.it/',
    use: 'Ricerca del testo vigente e delle versioni storiche. Verificare la data dell’atto e quella dei fatti.',
  },
  {
    title: 'Gazzetta Ufficiale',
    scope: 'Italia · pubblicazioni',
    url: 'https://www.gazzettaufficiale.it/',
    use: 'Pubblicazione degli atti. Pubblicazione, entrata in vigore e applicabilità sono date distinte.',
  },
  {
    title: 'EUR-Lex · protezione dei dati',
    scope: 'Unione europea · GDPR',
    url: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679',
    use: 'Riferimento per finalità, minimizzazione, sicurezza e condizioni del trattamento. Non autorizza automaticamente una registrazione.',
  },
  {
    title: 'SUAP Palermo',
    scope: 'Comune · attività produttive',
    url: 'https://supera.comune.palermo.it/supera/jsp/home.do?sportello=supera',
    use: 'Procedimenti, modulistica e riferimenti locali da collegare alla sede e all’attività effettiva.',
  },
  {
    title: 'Regione Siciliana',
    scope: 'Regione · atti e pubblicazioni',
    url: 'https://www.regione.sicilia.it/',
    use: 'Individuare gli atti regionali applicabili e la pubblicazione ufficiale. La sola notizia non prova la vigenza.',
  },
  {
    title: 'Garante · registrazioni sul lavoro',
    scope: 'Provvedimento del 16 novembre 2023',
    url: 'https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9963486',
    use: 'Caso riguardante raccolta generalizzata di audio sul lavoro: un avviso non sostituisce la verifica dei presupposti giuridici.',
  },
];
export function dayDiff(s: string) {
  if (!s) return null;
  return Math.floor(
    (Date.parse(s + 'T00:00:00Z') -
      Date.parse(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) + 'T00:00:00Z')) /
      86400000,
  );
}
export function docState(d: any) {
  const days = dayDiff(d.expires);
  if (days !== null && days < 0) return { text: 'Data superata', tone: 'red' };
  if (days !== null && days <= 30) return { text: 'Entro 30 giorni', tone: 'amber' };
  return { text: d.reviewed ? 'Verifica annotata' : 'Da verificare', tone: d.reviewed ? 'blue' : 'gray' };
}
export function checks(profile: Profile, docs: Entry[]) {
  const list: any[] = [];
  if (!profile.legalName || !profile.vat || !profile.address)
    list.push({
      title: 'Completa l’identità dell’impresa',
      detail: 'Ragione sociale, partita IVA e sede servono per confrontare correttamente i documenti.',
      tone: 'amber',
      target: 'profile',
    });
  docs.forEach(d => {
    const x = d.data;
    const state = docState(x);
    if (state.tone === 'red' || state.tone === 'amber')
      list.push({
        title: x.title,
        detail:
          state.tone === 'red'
            ? 'La data inserita è superata. Verifica rinnovo, proroghe e applicabilità.'
            : 'La data inserita è nei prossimi 30 giorni. Prepara il riesame.',
        tone: state.tone,
        target: 'archive',
      });
    if (profile.vat && x.vat && profile.vat.replace(/\D/g, '') !== x.vat.replace(/\D/g, ''))
      list.push({
        title: 'Intestazione da confrontare: ' + x.title,
        detail:
          'La partita IVA del documento differisce dal profilo. Verifica soggetto, subingresso e periodo di riferimento.',
        tone: 'amber',
        target: 'archive',
      });
    if (
      profile.address &&
      x.address &&
      profile.address.trim().toLowerCase() !== x.address.trim().toLowerCase()
    )
      list.push({
        title: 'Sede da confrontare: ' + x.title,
        detail:
          'Gli indirizzi inseriti non coincidono testualmente. Potrebbe essere una diversa scrittura o una sede differente.',
        tone: 'amber',
        target: 'archive',
      });
  });
  if (profile.dehors === 'Sì' && !docs.some(d => d.data.category === 'Dehors e suolo pubblico'))
    list.push({
      title: 'Fascicolo dehors da completare',
      detail:
        'Hai indicato un dehors ma non risultano documenti di questa categoria. Verifica con il tecnico quali titoli occorrono.',
      tone: 'amber',
      target: 'archive',
    });
  if (profile.staff === 'Sì' && !docs.some(d => d.data.category === 'Sicurezza sul lavoro'))
    list.push({
      title: 'Documentazione del lavoro da censire',
      detail: 'Hai indicato personale. Raccogli e fai verificare i documenti pertinenti con il consulente.',
      tone: 'amber',
      target: 'archive',
    });
  return list;
}
export function guidance(question: string, docs: Entry[]) {
  const q = question.toLowerCase();
  let category = '';
  let response =
    'Può precisare il documento o il fatto oggetto della richiesta, così verifichiamo il fascicolo corretto?';
  let note = 'Formula organizzativa da adattare. Non è una valutazione legale.';
  if (/agibil|urbanistic|planimetri|ediliz/.test(q)) {
    category = 'Edilizia e agibilità';
    response =
      'Verifichiamo il titolo relativo a questa sede e la documentazione tecnica collegata. Può indicare con precisione quale atto sta richiedendo?';
    note =
      'Titoli commerciali, edilizi e agibilità vanno esaminati distintamente. Occorre il tecnico per valutarne gli effetti.';
  } else if (/haccp|aliment|sanitari|igiene/.test(q)) {
    category = 'Igiene e HACCP';
    response =
      'Apro il fascicolo di igiene alimentare. Verifichiamo insieme a quale documento e a quale periodo si riferisce la richiesta.';
  } else if (/dehors|suolo|tavoli|occupaz/.test(q)) {
    category = 'Dehors e suolo pubblico';
    response = 'Verifichiamo il titolo, la planimetria, il periodo e l’area cui si riferisce la richiesta.';
  } else if (/scia|licenz|autorizz/.test(q)) {
    category = 'Titoli e SCIA';
    response =
      'Verifichiamo il titolo dell’attività, l’intestazione e le comunicazioni successive, per individuare la versione pertinente.';
  } else if (/dvr|sicurezza|antincend/.test(q)) {
    category = 'Sicurezza sul lavoro';
    response =
      'Richiamo il fascicolo della sicurezza e il referente. Può precisare quale documento occorre esibire?';
  } else if (/dipendent|contratt|formaz|personale/.test(q)) {
    category = 'Personale e formazione';
    response =
      'Individuiamo i documenti pertinenti alla richiesta e al lavoratore interessato con il responsabile.';
  } else if (/verbale|sanzion|firma|chiusura|sequestr/.test(q)) {
    category = 'Verbali e comunicazioni';
    response =
      'Leggiamo integralmente l’atto e distinguiamo i fatti riportati dalle valutazioni. Chiedo copia e contatto il professionista per esaminare gli adempimenti e i termini.';
    note =
      'Non calcolare scadenze di ricorso né decidere sulla firma da questa scheda: dipendono dall’atto e dalla procedura.';
  }
  return {
    response,
    note,
    category,
    docs: docs
      .filter(d => (category ? d.data.category === category : d.data.title.toLowerCase().includes(q)))
      .slice(0, 8),
  };
}
