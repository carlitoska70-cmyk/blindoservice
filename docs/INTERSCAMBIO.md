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

Se rimandi la stessa `chiaveEsterna`, la proposta viene aggiornata e non duplicata. Risposta: `201 { id, stato: "in_attesa" }`, oppure `200 { aggiornata: true }`.

## Cosa manda Gionti Suite (previsto)

- Operatori attivi (nome, mansione, data di assunzione) → `dipendente`
- Report HACCP del sabato, registro temperature e libro degli allergeni in PDF → `documento` (categoria "Igiene e HACCP")
- Schede dei macchinari e delle attrezzature → `documento` ("MOCA, acqua e attrezzature alimentari")

E cosa legge: scadenze dei documenti, per il Direttore e il briefing del mattino, e dipendenti con documenti mancanti.
