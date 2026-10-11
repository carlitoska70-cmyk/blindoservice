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

## Struttura

- `app/presidio.tsx`: il guscio dell'area del titolare; ogni sezione è in `app/_presidio/`
- `app/api/*`: le API server (stato, file, portale, postazione, IA, import)
- `lib/`: regole di dominio, catalogo, autenticazione admin, riconoscimento documenti
- `drizzle/`: migrazioni D1; `scripts/admin-login-schema.sql` crea le tabelle di login
- `wrangler.jsonc` serve solo alla produzione, `wrangler.local.json` solo allo sviluppo locale

Altri documenti: `LEGGIMI_PRIMA.txt` per iniziare, `GUIDA_COMPLETA_PRESIDIO.txt` per l'uso
e la gestione (il capitolo 0 è aggiornato), `COLLAUDO.txt` per le verifiche e `AGENTS.md`
per chi modifica il codice. La documentazione originale del framework è in
`docs/README_ORIGINALE_STARTER.md`.
