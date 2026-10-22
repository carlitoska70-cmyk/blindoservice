# Presidio (Blindoservice)

Archivio documentale e assistenza ai controlli per un'impresa (bar/ristorazione):
schede e originali, catalogo di 200 voci, QR per i controllori con portale a tempo,
postazione del titolare, registrazione audio e riesame con OpenAI.

Next.js (vinext) su Cloudflare Workers, con D1 (database) e R2 (allegati).

## Avvio rapido sul Mac

```bash
cd "$HOME/Desktop/blindoservice"
bash INSTALLA.command
bash CONFIGURA_ACCESSO_LOCALE.command
bash AVVIA.command
```

Apri http://localhost:5173/login con l'email e la password mostrate da
`CONFIGURA_ACCESSO_LOCALE.command`. I dati locali sono separati da quelli online.

## Comandi di sviluppo

| Comando | Cosa fa |
| --- | --- |
| `corepack pnpm run typecheck` | Controllo TypeScript |
| `corepack pnpm run lint` | ESLint |
| `corepack pnpm run format` | Prettier su app, lib, db, scripts, tests |
| `corepack pnpm test` | Test di accesso e dei moduli |
| `corepack pnpm run test:e2e` | Build e test end-to-end (Playwright) |
| `corepack pnpm run build` | Build di produzione in `dist/` |

## Strumenti sul Mac

| Comando | Cosa fa |
| --- | --- |
| `BACKUP_ONLINE.command` | Backup del database e degli allegati online |
| `CONFIGURA_PROMEMORIA.command` | Promemoria delle scadenze via Telegram/email |
| `CONFIGURA_COLLABORATORE.command` | Accesso limitato per un collaboratore |
| `CONFIGURA_ACCESSO_LOCALE.command` | Password per l'app in locale |
| `CONFIGURA_HOLDING.command` | Collega Blindo alla centrale di Gionti Holding (solo la copia di Carlo) |

## Collegamento a Gionti Holding

Ogni ora (al minuto 7, Cron Trigger in `wrangler.jsonc`) il Worker parla con la centrale dei
software di Kassaro OS, con `Authorization: Bearer <chiave>`:

1. **Legge le evidenze** del gestionale (`GET /api/holding/evidenze`, Kassaro OS 8.3.0): per ogni
   requisito che il gestionale copre (manuale HACCP, temperature, pulizie, fatture, allergeni,
   fornitori, MOCA, formazione…) dice presente, parziale o assente, con un dettaglio, la data e la
   sezione del gestionale. Blindo le salva come un record `evidence` del titolare
   (`evidenze:<owner>`); se la centrale non risponde resta l'ultima lettura, con la sua data.
   - Nel **Catalogo**, sotto ogni voce con lo stesso titolo: «Dal gestionale Kassaro OS: …,
     aggiornato al …» e il link al gestionale. L'applicabilità e il revisore non cambiano: li
     decide il titolare.
   - Nel **portale del controllore**, solo dopo che il titolare ha autorizzato la sessione e finché
     il link è valido: «Apri i registri HACCP» verso la pagina dei controlli del gestionale.
2. **Manda il segnale** (`POST /api/holding/segnale`) `{stato, testo, dati}`:
   - versione; documenti scaduti e in scadenza entro 30 giorni (titolo, data, giorni); controlli
     aperti e conclusi negli ultimi 90 giorni (ente, oggetto, stato, date); portale QR attivo sì/no;
   - `dati.da_completare`: i nomi dei campi del profilo vuoti, segnaposto o da confermare (mai i
     valori); documenti da verificare, senza voce del catalogo, senza scadenza indicata (una data
     assente non è validità illimitata), con i titoli; requisiti coperti dal gestionale ma ancora
     «Da valutare»; quando sono state lette le evidenze;
   - al massimo 16 KB: se serve si accorciano gli elenchi, i conteggi restano esatti.

Non escono allegati, nomi/qualifiche/targhe/protocolli dei controllori, esiti scritti a mano,
azioni, valori del profilo né il link alla pagina HACCP. L'«ente» di un controllo è l'istituzione
(per i controlli nati dal QR è l'ufficio dichiarato, es. ASP o NAS), non una persona.

- `stato`: `attenzione` se c'è un documento scaduto o un controllo aperto, altrimenti `ok`;
  `errore` se l'archivio non si legge. La centrale riscrive stato e testo dei software online a
  ogni controllo di 5 minuti: per questo sono ripetuti in `dati.riepilogo`.
- Parte solo se il Worker ha il segreto `HOLDING_SEGNALE_KEY` (chiave del software `blindo`,
  strumento `chiave_software` del connettore Kassaro OS), impostato con `CONFIGURA_HOLDING.command`.
  Una chiave nuova annulla la precedente: crearne una sola e salvarla subito.
  **Nelle copie date ad altri esercenti non va impostato**: senza chiave non si legge e non si
  manda nulla, quindi i loro dati restano solo nel loro archivio.
- Se la centrale non risponde si scrive una riga nei log del Worker («holding …») e si riprova l'ora
  dopo: il sito continua a funzionare come prima. Scollegare:
  `corepack pnpm exec wrangler secret delete HOLDING_SEGNALE_KEY --config wrangler.jsonc`.
- Codice: `worker/index.ts` (ingresso del Worker: sito + `scheduled`), `lib/holding.ts`.
  Test: `scripts/test-holding.mjs` ed `e2e/holding.spec.ts` (Worker locale e finta centrale).
- A ogni pubblicazione aumentare `version` in `package.json`: è la versione che vede la holding.

## Struttura

- `app/presidio.tsx`: il guscio dell'area del titolare; ogni sezione è in `app/_presidio/`
- `worker/index.ts`: l'ingresso del Worker (il sito più l'invio orario alla holding)
- `app/api/*`: le API server (stato, file, portale, postazione, IA, import)
- `lib/`: regole di dominio, catalogo, autenticazione admin, riconoscimento documenti
- `drizzle/`: migrazioni D1; `scripts/admin-login-schema.sql` crea le tabelle di login
- `wrangler.jsonc` serve solo alla produzione, `wrangler.local.json` solo allo sviluppo locale

Altri documenti: `LEGGIMI_PRIMA.txt` per iniziare, `GUIDA_COMPLETA_PRESIDIO.txt` per l'uso
e la gestione (il capitolo 0 è aggiornato), `COLLAUDO.txt` per le verifiche e `AGENTS.md`
per chi modifica il codice. La documentazione originale del framework è in
`docs/README_ORIGINALE_STARTER.md`.
