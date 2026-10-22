# Conservazione dei dati

Regole di conservazione dei dati personali (art. 5.1.e e art. 25 GDPR), decise con il titolare il 22/10/2026.
Riferimento: documento «10 Conservazione e modifiche ai programmi» della privacy del Caffè del Kassaro.

## Controlli e portale QR (automatico)

| Dato | Regola |
| --- | --- |
| Sessioni del portale (identità dichiarata, ricerche, documenti aperti, permessi) | Cancellate 120 giorni dopo l'ultima attività del controllo |
| Annotazioni, audio, trascrizioni, bozze IA, segmenti e suggerimenti live, rapporti PDF | Cancellati insieme, file su R2 compresi |
| Fascicolo del controllo | Resta come storico: ente, oggetto, date, riferimento, esito. Nomi degli agenti cancellati e `anonimizzato` impostato |
| «Procedimento in corso» | Blocca la cancellazione. Quando lo segni «Procedimento chiuso», la cancellazione avviene 30 giorni dopo |
| Sessioni del portale senza fascicolo | Cancellate 120 giorni dopo l'ultimo segnale |
| Registro degli ascolti (`ascolto`) | Una riga per file ogni 10 minuti; cancellato insieme all'audio |

- `lib/retention.ts`: regole pure (`inspectionDue`, `retentionPlan`) ed esecuzione su D1 e R2 (`runRetention`, `purgeInspection`, `dropFiles`).
- Gira dal Cron del Worker (`worker/index.ts`), al massimo una volta ogni 20 ore per titolare. Gira in ogni copia, anche senza la chiave della holding.
- Un file caricato si cancella solo se nessun altro record lo usa. Esempio: un documento dell'archivio esibito durante il controllo resta.
- Ogni cancellazione aggiorna il record `retention:<owner>` (`lastPurge`, storico). `GET /api/state?since=` ricarica tutto se `lastPurge` è successivo al cursore, perché i record cancellati non arrivano con la sincronizzazione incrementale.
- I campi `procedimento`, `procedimentoChiuso` e `anonimizzato` del fascicolo li scrive solo il server. L'azione è `procedimento` in `/api/state`, e la modifica del fascicolo dal modulo li conserva.
- Interfaccia: `app/_presidio/retention-panel.tsx` (barra nel fascicolo, avviso 14 giorni prima nella Situazione, ascolti accanto all'audio).

## Personale (confermato dal titolare)

Per gli ex dipendenti (non attivi, con data di fine rapporto):

| Documento | Si può cancellare dopo |
| --- | --- |
| Documento d'identità e codice fiscale | 12 mesi |
| Permesso di soggiorno | 6 anni |
| Tutto il resto | 5 anni |
| La scheda del dipendente | 5 anni, e solo quando non ha più documenti abbinati |

`lib/staff.ts` (`staffDocUntil`, `staffRecordUntil`). L'azione `purge` di `/api/state` è riservata al titolare e il server ricontrolla il termine. Nella scheda Dipendenti il titolare cancella documento per documento: niente si cancella da solo.

I documenti personali (identità, permessi, codice fiscale, buste paga, certificati medici) caricati dalla scheda Dipendenti non vanno al riconoscimento IA: `SENSITIVE_STAFF_DOC`.

## Minimizzazione nel portale

- La targa non si chiede più. Nome, cognome ed ente sono obbligatori, qualifica e oggetto facoltativi.
- Le notifiche Telegram ed email contengono solo l'ente e l'oggetto, nessun nome.
- Il pulsante «Dati per l'interessato» in Accessi QR esporta i dati di una visita per rispondere a una richiesta di accesso (art. 15), senza note interne.
- Informativa del portale: il modello in `lib/portal-notice.ts`. L'attivazione resta bloccata finché nel testo restano parti «DA COMPLETARE».

## Test

- `scripts/test-retention.mjs`: regole, piano, cancellazione su SQLite e R2 finti, termini del personale, modello dell'informativa.
- `tests/access-control.mjs`: procedimento (titolare sì, collaboratore no), modifica che conserva il blocco, ascolti, cancellazione dei documenti del personale, ricarica completa dopo una cancellazione, esecuzione notturna sulle rotte vere, dati per l'interessato, blocco dell'attivazione.
- `e2e/owner.spec.ts`: «conservazione: data di cancellazione e procedimento in corso».
