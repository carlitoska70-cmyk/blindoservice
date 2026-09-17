# Presidio — continuità di sviluppo

Questo è l'export del sito esistente, non un progetto nuovo. Prima di intervenire
leggere LEGGIMI_PRIMA.txt, GUIDA_COMPLETA_PRESIDIO.txt, COLLAUDO.txt e PRODUCT.md.
Le note di stato aggiornate nella guida prevalgono sui passaggi storici di PRODUCT.md.

- Conservare contenuti, stile e capacità esistenti salvo richiesta esplicita.
- Conservare l'identità in .openai/hosting.json. Non creare un altro sito.
- Usare Sites per modifiche/publish del sito ospitato; non confondere sviluppo
  locale con pubblicazione. Una richiesta di solo ZIP/backup non è una modifica online.
- Conservare pnpm-lock.yaml, package manager e versioni compatibili.
- Il sito usa Cloudflare Workers, D1 e R2; l'autenticazione online è gestita
  dalla piattaforma. Il mock locale già incluso è solo per loopback e sviluppo.
- Non estendere il mock al sito online o alla LAN. Non rimuovere getOperator,
  verifiche owner, origine, autorizzazioni visitatori e protezione allegati.
- Non leggere/stampare chiavi se non indispensabile; mai includere .dev.vars,
  .env*, credenziali Git o dati utente negli ZIP sorgente.
- Il toolkit PC preserva .wrangler/state e .dev.vars durante aggiornamenti.
  Prima di migrazioni/aggiornamenti fermare il server e fare un backup.
- Eseguire test significativi per le modifiche. Per l'accesso esiste
  `node tests/access-control.mjs`. Non descrivere un mock come test IA reale.
- Per una release PC: aggiornare guida e COLLAUDO.txt, eseguire
  `node scripts/release-manifest.mjs`, poi `node scripts/pc.mjs verify`.
  Zippare solo i file del manifesto e il manifesto, sotto una cartella blindoservice.
- Fornire comandi Mac completi con `cd "$HOME/Desktop/blindoservice"`.
- Se ci sono modifiche locali, integrarle prima dell'aggiornamento. Lo script
  update rifiuta di sovrascrivere un file modificato rispetto al manifesto.
- L'esportazione sorgente non è un backup del database/R2 online. Non promettere
  sincronizzazione, conservazione certificata o ricerca normativa non implementate.
