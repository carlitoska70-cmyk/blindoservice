// Privacy notice shown in the QR portal (art. 13 GDPR). Every business that uses Blindo Service is
// the controller of its own portal: the template starts from its profile and marks with
// «DA COMPLETARE» what only the owner can fill in. The portal cannot be switched on until the
// notice is long enough and has no marker left. Self-contained (no imports) so the Node tests can
// load it directly: NOTICE_DAYS must stay equal to CONTROL_DAYS in lib/retention.ts (checked by the tests).
export const NOTICE_DAYS = 120;

export const NOTICE_TODO = 'DA COMPLETARE';
export const NOTICE_MIN = 120;

type ProfileLike = { name?: string; legalName?: string; vat?: string; address?: string; city?: string };

/** Why the notice is not ready yet, or null when the portal can be switched on. */
export function noticeProblem(text: string | undefined) {
  const t = String(text || '').trim();
  if (t.length < NOTICE_MIN)
    return 'Completa l’informativa del portale nella sezione Azienda prima di attivare gli accessi.';
  if (t.includes(NOTICE_TODO))
    return `Nell’informativa del portale restano parti «${NOTICE_TODO}»: completale nella sezione Azienda prima di attivare gli accessi.`;
  return null;
}

const todo = (what: string) => `[${NOTICE_TODO}: ${what}]`;

export function portalNoticeTemplate(p: ProfileLike) {
  const who = [
    p.legalName || todo('titolare o ragione sociale'),
    p.name && p.name !== p.legalName ? `«${p.name}»` : '',
    [p.address, p.city].filter(Boolean).join(', ') || todo('indirizzo'),
    p.vat ? 'P.IVA ' + p.vat : todo('partita IVA'),
    todo('telefono ed email per la privacy'),
  ]
    .filter(Boolean)
    .join(', ');
  return `INFORMATIVA PRIVACY · PORTALE DEI CONTROLLI (art. 13 Reg. UE 2016/679)

Titolare del trattamento: ${who}.

Quali dati: nome, cognome, ente e ufficio e, se li indica, qualifica e oggetto del controllo; data e ora della sessione, ricerche fatte e documenti aperti. L’indirizzo IP del dispositivo serve solo a limitare i tentativi di accesso e si cancella entro un’ora.

Perché: per permetterle di consultare i documenti dell’attività e per documentare quali documenti sono stati richiesti ed esibiti, anche per tutelare i diritti dell’impresa in un eventuale procedimento. Base giuridica: legittimo interesse del titolare (art. 6.1.f GDPR). Il nome inserito non costituisce verifica dell’identità.

Dati necessari: nome, cognome ed ente servono per abilitare la consultazione; qualifica e oggetto sono facoltativi. Se preferisce non usare il portale, il responsabile presente nel locale le esibisce i documenti su carta o sul proprio dispositivo.

Registrazione audio: questo portale non attiva il microfono del suo dispositivo. Il titolare o il preposto che partecipano al controllo possono registrare l’audio del colloquio con il proprio telefono: in quel caso la avvisano prima di iniziare. L’audio può essere trascritto con un servizio di intelligenza artificiale (OpenAI) e resta riservato all’impresa e al suo legale.

Destinatari: Cloudflare, Inc., fornitore del servizio, che tratta i dati per conto del titolare (responsabile del trattamento); per la trascrizione degli audio OpenAI Ireland Ltd (responsabile del trattamento). Eventuali trasferimenti verso gli Stati Uniti avvengono con il Data Privacy Framework UE-USA o con le clausole contrattuali standard della Commissione Europea. Il legale dell’impresa, se necessario. I dati non sono diffusi.

Per quanto tempo: ${NOTICE_DAYS} giorni dalla fine del controllo, poi vengono cancellati in automatico. Se viene notificato un verbale o una contestazione, fino alla conclusione definitiva del procedimento.

I suoi diritti: accesso, rettifica, cancellazione, limitazione e opposizione (artt. 15–21 GDPR), scrivendo a ${todo('email')}. Può proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).

La presa visione di questa informativa non equivale a un consenso generale né a un’accettazione dei fatti oggetto del controllo.`;
}
