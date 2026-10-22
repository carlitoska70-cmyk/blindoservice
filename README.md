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

Ogni ora (al minuto 7, Cron Trigger in `wrangler.jsonc`) il Worker manda un riepilogo alla
centrale dei software di Kassaro OS: `POST https://kassaro-os.onrender.com/api/holding/segnale`
con `Authorization: Bearer <chiave>` e JSON `{stato, testo, dati}`. Così il quartier generale
«Gionti Holding» e il Direttore (strumento `stato_software`) vedono scadenze e controlli.

- `dati`: versione, documenti scaduti e in scadenza entro 30 giorni (titolo, data, giorni),
  controlli aperti e conclusi negli ultimi 90 giorni (ente, oggetto, stato, date), portale QR
  attivo sì/no. Al massimo 16 KB: se serve si accorciano gli elenchi, i conteggi restano esatti.
- Non escono allegati, dati dei controllori (nomi, qualifiche, targhe, uffici, protocolli),
  esiti scritti a mano, azioni, profilo dell'azienda.
- `stato`: `attenzione` se c'è un documento scaduto o un controllo aperto, altrimenti `ok`;
  `errore` se l'archivio non si legge. La centrale riscrive stato e testo dei software online a
  ogni controllo di 5 minuti: per questo sono ripetuti in `dati.riepilogo`.
- Parte solo se il Worker ha il segreto `HOLDING_SEGNALE_KEY` (chiave del software `blindo`,
  strumento `chiave_software` del connettore Kassaro OS). Si imposta con
  `CONFIGURA_HOLDING.command`, che prova la chiave e la salva solo nei segreti Cloudflare.
  **Nelle copie date ad altri esercenti non va impostato**: senza chiave non si legge e non si
  manda nulla, quindi i loro dati restano solo nel loro archivio.
- Se l'invio fallisce si scrive una riga nei log del Worker e si riprova l'ora dopo: il sito
  continua a funzionare come prima. Scollegare:
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
