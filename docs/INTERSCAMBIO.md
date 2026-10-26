# Interscambio con i programmi della holding

Blindo Service è il **registro generale** dei documenti e del personale. Gli altri software della holding (Gionti Suite / Kassaro OS e i prossimi) leggono da qui e **propongono** quello che manca. Una proposta entra nel registro solo dopo che il titolare la accetta (Azienda › Proposte dagli altri programmi).

## Chiavi

Il titolare crea una chiave per ogni programma in Azienda › Collegamenti con gli altri programmi, scegliendo i permessi:

| Permesso | Cosa consente |
| --- | --- |
| `documenti:leggi` | elenco documenti e scadenze, `/stato` |
| `file:leggi` | scaricare gli originali (mai gli audio dei controlli) |
| `dipendenti:leggi` | dipendenti, documenti mancanti e in scadenza |
| `proposte:scrivi` | proporre documenti e dati del personale |

Formato: `blk_` + 43 caratteri. Si manda come `Authorization: Bearer <chiave>`. Viene mostrata una sola volta e nel database ne resta solo l'impronta SHA-256. Limite: 600 richieste l'ora per chiave. Revocabile in qualsiasi momento.

## Endpoint (`https://<sito>/api/holding/v1/...`)

### `GET /stato`
`{ software: "blindo-service", ok, chiave, conteggi: {document, employee, inspection}, proposteInAttesa, ora }`

### `GET /documenti?since=<ISO>&dipendente=<id>`
`{ documenti: [{ id, title, category, documentType, issued, expires, holder, employeeId, hasFile, reviewed, archived, updated }], cursor }`
Le note interne non escono mai. Il programma salva `cursor` e alla volta successiva chiede solo le modifiche.

### `GET /file?documento=<id>`
L'originale, con header `X-Content-SHA256`.

### `GET /dipendenti`
`{ dipendenti: [{ id, externalId, name, role, missing: [..], expiring: [..], contractEnd, complete, total }] }`

### `POST /proposte`
JSON `{ tipo, chiaveEsterna, dati }` oppure multipart con gli stessi campi (`dati` come stringa JSON) più `file` (PDF/JPEG/PNG/WebP, massimo 20 MB).

- `tipo: "dipendente"`, dati: `{ name, role?, hired?, contract?, endDate?, active? }`. `chiaveEsterna` = id del dipendente nel programma, per esempio l'id dell'operatore di Gionti Suite.
- `tipo: "documento"`, dati: `{ title, category?, documentType?, issued?, expires?, holder?, employeeExternalId?, notes? }`. Con `employeeExternalId` il documento viene abbinato al dipendente già ricevuto dallo stesso programma.

Se rimandi la stessa `chiaveEsterna` con dati (e file) diversi, la proposta viene aggiornata, non duplicata, e torna in attesa: `200 { aggiornata: true, stato: "in_attesa" }`. Se dati e file sono identici all'ultima volta non cambia niente, e una proposta già accettata resta accettata: `200 { invariata: true, stato }`. Prima volta: `201 { id, stato: "in_attesa" }`.

## Personale dalla centrale (Kassaro OS 8.4.0, Blindo 0.4.1)

Gionti Suite non ha bisogno di una chiave di Blindo per il personale: ogni ora Blindo legge dalla centrale `GET /api/holding/operatori`, con la stessa chiave del segnale (`HOLDING_SEGNALE_KEY`). Arrivano gli operatori attivi con nome, mansione o reparto e data di assunzione, e niente altro.

- Ogni persona diventa una proposta `dipendente` con origine «Gionti Suite» e chiave `dipendente:<id dell'operatore>`.
- Rimandata uguale, resta com'è, anche se è già accettata. Se cambia, torna in attesa.
- Quando il titolare accetta, la proposta si collega al dipendente che ha già lo stesso nome e non è ancora collegato («Faraci Dorotea» = «Dorotea Faraci»), invece di crearne un doppione. I campi scritti dal titolare restano quando il gestionale li lascia vuoti.
- Chi lascia il gestionale non viene tolto da Blindo: la fine del rapporto la segna il titolare.
- Nel segnale orario `dati.personale` riporta attivi, completi e chi ha documenti mancanti o in scadenza (nomi ed etichette dei documenti, mai i file). Il Direttore lo legge con lo strumento `registro_blindo` di Kassaro OS.

## Controllo in corso (Blindo 0.5.0, Kassaro OS 9.0.3)

Quando un controllore si identifica al portale QR, Blindo non aspetta il giro orario. Manda subito alla holding il suo segnale completo con `dati.allerta = { tipo: "controllo", id, ente, motivo, ora, link }`: c'è solo l'ufficio e il motivo dichiarato, mai nomi, qualifiche o targhe. La holding avvisa il telefono di Carlo anche durante la quiete serale, una volta per visita e al massimo 10 volte al giorno. Toccando l'avviso si apre `link` (Blindo Service).

L'avviso parte solo nella copia di Carlo, perché è l'unica con `HOLDING_SEGNALE_KEY`. Nelle copie degli altri esercenti restano Telegram o email (lib/notify.ts), se configurati.

## Cosa manda Gionti Suite (previsto)

- Operatori attivi (nome, mansione, data di assunzione) → `dipendente`
- Report HACCP del sabato, registro temperature e libro degli allergeni in PDF → `documento` (categoria "Igiene e HACCP")
- Schede dei macchinari e delle attrezzature → `documento` ("MOCA, acqua e attrezzature alimentari")

E cosa legge: scadenze dei documenti, per il Direttore e il briefing del mattino, e dipendenti con documenti mancanti.
