# La fabbrica delle copie

Ogni esercente ha la sua copia di Blindo Service: un Worker, un database D1 e un archivio R2 sull'account Cloudflare di Carlo. La copia nasce vuota, senza dati del Kassaro e senza collegamento a Gionti Holding.

## Comandi (dalla cartella del programma, con `wrangler login` già fatto)

Prima di `crea` e `aggiorna` serve la build: `corepack pnpm run build`.

| Comando | Cosa fa |
| --- | --- |
| `node scripts/fabbrica.mjs crea bar-rossi --tetto 10 --portale https://…` | Crea programma, database e archivio, prepara le tabelle, pubblica, imposta i segreti e stampa il link di attivazione |
| `node scripts/fabbrica.mjs attivazione bar-rossi` | Nuovo link di attivazione, anche per una chiave persa |
| `node scripts/fabbrica.mjs aggiorna` | Pubblica la build corrente su tutte le copie (oppure solo su quelle nominate) |
| `node scripts/fabbrica.mjs sospendi bar-rossi` / `riattiva bar-rossi` | Sola lettura per chi non paga: portale QR, accesso e avvisi continuano a funzionare |
| `node scripts/fabbrica.mjs tetto bar-rossi 15` | Cambia il tetto mensile dell'IA, in euro |
| `node scripts/fabbrica.mjs chiave-ia` | Reimposta la chiave OpenAI su tutte le copie |
| `node scripts/fabbrica.mjs elenco` | Elenco delle copie |
| `node scripts/fabbrica.mjs elimina bar-rossi --conferma bar-rossi` | Cancella programma, database e archivio. Prima il cliente deve aver scaricato i suoi dati |

Con `--prova` il comando mostra cosa farebbe senza toccare Cloudflare.

## Attivazione

Il link vale 7 giorni e una volta sola, e nella copia resta solo la sua impronta. Il cliente apre `/attiva`, scrive la sua email e Blindo crea la chiave lì, mostrandola una sola volta: la chiave non passa da email né dal portale. Un nuovo link sostituisce la chiave vecchia e chiude le sessioni aperte.

## Limiti

- Registro in `BLINDO_COPIE_DIR` (predefinito `~/Desktop/siti/blindo-copie`): conserva solo le impronte delle chiavi.
- Cloudflare a pagamento: 500 Worker per account, quindi poco meno di 500 esercenti. Oltre si passa a Workers for Platforms.
- `HOLDING_SEGNALE_KEY` non va mai messo su una copia: Gionti Holding è solo di Carlo.
- Il tetto dell'IA si basa su una stima dai consumi restituiti da OpenAI: protegge dalla spesa, non è una fattura.
