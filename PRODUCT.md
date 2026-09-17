# Presidio — specifica e stato della versione operativa QR

## Obiettivo

Aiutare il responsabile di un’impresa a preparare i documenti, gestire un controllo con ordine e fornire al professionista un fascicolo verificabile. Primo perimetro: un titolare, una sede, bar/ristorazione a Palermo. Il prodotto non certifica la conformità dell’impresa e non accerta reati.

## Funzioni implementate

- Accesso riservato del titolare mediante autenticazione della piattaforma; ogni lettura e scrittura verifica l’identità sul server.
- Profilo aziendale editabile, senza presumere ragione sociale o situazione giuridica da informazioni precedenti.
- Archivio persistente delle schede, upload PDF/immagini, apertura autenticata degli originali.
- Date inserite manualmente: data superata e finestra di 30 giorni. Una data mancante non equivale a validità illimitata. Le date di riesame non vengono presentate come un accertamento di scadenza legale.
- Confronti deterministici di partita IVA e indirizzo; indicazioni di documentazione da censire per dehors o personale dichiarato. Differenze testuali sono ipotesi da verificare, non violazioni.
- Attività con responsabile, data, istruzioni e stato.
- Fascicolo di controllo con ente, oggetto, interlocutori dichiarati, riferimento e annotazione finale.
- Cronologia append-only delle annotazioni dell’utente. Le schede editate conservano una revisione nel database e nell’esportazione JSON. Il sistema non offre ancora conservazione a norma o immutabilità certificata.
- Ricerca per categorie e formule operative predefinite sulla base del testo digitato. Queste risposte rapide sono modelli organizzativi, non interpretazioni generate dall’audio.
- Registrazione audio su comando dal dispositivo del titolare, indicatore persistente, arresto, anteprima e archiviazione automatica dopo arresto. Se l’invio fallisce rimane la copia locale scaricabile; nessuna garanzia di registrazione in background o recupero dopo chiusura forzata. Il microfono del visitatore non viene attivato.
- SHA-256 degli allegati acquisiti. Il digest verifica uguaglianza dei byte e non prova da solo autenticità, origine, completezza, data certa o valore probatorio.
- Esportazione della cronologia TXT e dei metadati JSON. Gli originali si scaricano separatamente.
- QR fisso su /accesso: modulo esterno con nome, cognome, ufficio, ruolo e oggetto obbligatori per usare il portale; targa facoltativa. Identità dichiarata, da verificare dal titolare. Esibizione assistita disponibile fuori dal portale.
- 200 voci di catalogo in 18 categorie. Priorità organizzativa, condizione, descrizione e riferimento di area per ogni voce. Applicabilità motivata dal responsabile, collegamento a originali. Nessuna pretesa di esaustività normativa o obbligatorietà universale.
- Accesso visitatore con token casuale, sola impronta nel database, cookie HttpOnly/Secure, scadenza massima 4 ore, revoca e limiti richieste. Nessun allegato prima di autorizzazione del titolare.
- Condivisione selettiva degli originali PDF/immagini. Il visitatore vede i risultati della propria ricerca e la storia dei soli documenti trovati. Descrizione pubblica separata dalle note interne.
- Postazione del titolare aggiornata ogni 4 secondi, evidenza del QR in uso, richieste assistenza, documento aperto e sua versione. Non è una duplicazione pixel per pixel dello schermo, non rileva pagine PDF effettivamente lette e non prova comprensione.
- Versione esibita fissata al momento dell’autorizzazione; aggiornare la scheda successivamente non cambia l’allegato già autorizzato. Riautorizzazione esplicita per modificarlo.
- Resoconto TXT con eventi del portale, riferimenti a file/versioni/impronte, annotazioni, audio e eventuali trascrizioni/bozze. Digest non equivale a data certa o certificazione probatoria.
- Integrazione server per trascrizione su richiesta e bozza di riesame. Richiede OPENAI_API_KEY; non configurata al momento della consegna. Prima di attivare: servizio e condizioni di trattamento tramite OpenAI Developers. Trascrizione segmentata con tempi e voci anonime; nessuna associazione biometrica all’identità. I frammenti citati nella bozza sono accettati soltanto se presenti testualmente nella trascrizione. Le altre affermazioni restano da verificare; non c’è ricerca normativa né lettura OCR degli originali nel riesame.
- Le API private consentono l’accesso esclusivamente all’identità del titolare configurata sul server. L’apertura esterna del percorso QR non rende pubblico il gestionale. Portale inizialmente disattivato, attivazione dopo inserimento dell’informativa dell’attività. L’informativa non viene validata giuridicamente dal programma.

## Da realizzare per il sistema completo

### Evoluzione del portale

Il portale esterno è implementato. Prima dell’uso con dati reali: completare identità e informativa aziendale, caricare documenti pertinenti e provare il flusso su due dispositivi. La visibilità pubblica riguarda il punto di ingresso, mentre originali, storico e audio restano protetti. La revoca impedisce nuovi accessi ai file; non può cancellare copie già legittimamente scaricate dal visitatore.

### Motore normativo

Fonti: EUR-Lex, Normattiva, Gazzetta Ufficiale, fonti ufficiali della Regione Siciliana, atti e regolamenti del Comune, SUAP, ASP e autorità competenti per materia. I siti di commento possono aiutare a scoprire un tema ma non sostituire il testo ufficiale.

Ogni regola necessita di: fonte e identificatore, testo/articolo, ambito territoriale e materiale, data pubblicazione, entrata in vigore, applicabilità, intervallo di validità, eventuali deroghe/abrogazioni/proroghe, legami con atti modificativi, data ultima acquisizione e revisore. Memorizzare separatamente testo storico e testo attuale. Un disegno di legge non è un obbligo vigente. Le interpretazioni e le sentenze non vanno trattate come testo normativo.

Pipeline: acquisizione con autorizzazioni e licenze appropriate → rilevazione differenze → estrazione candidata → controllo delle date → revisione della regola → valutazione sull’impresa → avviso motivato. Segnalare fonti irraggiungibili e dati troppo vecchi. Non dichiarare copertura completa del diritto italiano.

Esiti ammessi: applicabile e verificato; da verificare; non determinabile per dati mancanti; non applicabile con motivazione. Ogni rilievo include norma, versione, passaggio pertinente, fatti usati, evidenza documentale, incertezze, attività proposta e professionista responsabile. Nessun punteggio di “azienda sicura” ricavato soltanto dal numero di file caricati.

### Copilota durante il controllo

Acquisizione audio limitata alla sessione ammessa → trascrizione con timestamp → separazione interlocutori A/B/C → associazione manuale verificata dei ruoli → estrazione richiesta → recupero documenti e fonti → proposta breve sullo schermo → eventuale approfondimento. Nessun invio di documenti o risposta parlata senza azione del responsabile. Mostrare testo non chiaro come incerto; non inventare parole, norme o citazioni. Non identificare controllori da impronte vocali né inferire sincerità, intenzioni o reati dal tono.

Le priorità sono: documento pertinente, frase cortese, fonte consultabile e contatto del professionista quando serve. Un rifiuto, una firma, un ricorso o un termine processuale non devono dipendere da un suggerimento automatico privo dell’atto integrale e della revisione competente.

### Dossier successivo

Conservare originale audio e allegati, digest, riferimento temporale del dispositivo, registro accessi ed esportazioni. Le correzioni della trascrizione restano distinguibili dall’originale. Un passaggio problematico comprende estratto, contesto prima/dopo, identità verificata o incerta, fonte confrontata e stato della revisione. Le categorie sono “dichiarazione”, “incongruenza”, “possibile criticità” e “valutazione del professionista”, senza etichettare automaticamente persone come autori di reati. Il dossier non è il verbale ufficiale.

### Privacy e validazione prima dell’uso esteso

Occorre definire titolarità e responsabili, basi giuridiche, informative, necessità e proporzionalità delle registrazioni, protezione dei lavoratori, eventuale DPIA, conservazione differenziata, cancellazione, blocco conservativo motivato, gestione richieste degli interessati, fornitori e trasferimenti. Valutare l’applicabilità della disciplina sul lavoro e della normativa IA. L’annuncio della registrazione non costituisce da solo base giuridica. Il consenso non va assunto come soluzione universale nel lavoro. Non pubblicare audio o dati dei controllori.

Per la distribuzione a più imprese: ruoli (titolare, delegato, consulente), isolamento per organizzazione e sede, MFA o protezione equivalente, backup e restore verificati, revoca sessioni, audit, limiti di file, antivirus/analisi allegati, protezione da prompt injection e divieto di inviare documenti a siti suggeriti da contenuti acquisiti. Prevedere sincronizzazione e gestione offline sicura prima di promettere disponibilità durante assenza di rete.

## Criteri di accettazione delle fasi successive

- Nessun accesso a dati di altra impresa e nessun dato riservato nel QR pubblico.
- Fonte primaria e versione temporale per ogni conclusione normativa; astensione quando manca la prova.
- Nessuna transizione da “file presente” a “impresa conforme” senza controllo sostanziale.
- Nessuna identificazione biometrica e nessuna accusa automatica di reato.
- Test con voci sovrapposte, dialetto, rumore e scarsa connessione; indicazione dell’incertezza e recupero dei segmenti interrotti.
- Misure di latenza su casi reali prima di promettere risposte in un numero fisso di secondi.
- Revisione legale e tecnica delle regole del primo settore prima di ampliare territori e categorie.

## Fonti consultate per orientare la progettazione

- GDPR, Regolamento (UE) 2016/679: https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679
- Garante, provvedimento 16 novembre 2023, docweb 9963486: https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9963486
- SUAP Palermo: https://supera.comune.palermo.it/supera/jsp/home.do?sportello=supera
- Comune di Palermo, U.O. Somministrazione: https://www.comune.palermo.it/amministrazione/unita_organizzativa/uo-somministrazione-artigianato-e-commercio-su-area-pubblica/

Consultazione iniziale: 15 settembre 2026. Non è una due diligence normativa esaustiva. Il monitoraggio automatico non è stato attivato.

## Validazione della versione QR

Verifica TypeScript e build del sito. Test dei route handler effettivi con SQLite locale: utente anonimo/estraneo, richiesta prima dell’identificazione, attesa autorizzazione, identificazione incompleta, isolamento allegati, note private non divulgate, cronologia delle sole ricerche, versione esibita stabile, revoca, scadenza, origine della richiesta e IA assente. Nessuna chiamata IA reale o prova browser eseguita in questa fase.

La versione è un pilota per una sede. Il copilota vocale continuo, il motore normativo territoriale aggiornato, la conservazione certificata e la distribuzione multi-impresa sono fasi successive: non vengono presentati come già disponibili.
