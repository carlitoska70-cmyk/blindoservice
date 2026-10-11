export type CatalogItem = {
  id: string;
  category: string;
  title: string;
  priority: 'Prioritario' | 'Secondario' | 'Opzionale';
  condition: string;
  description: string;
  source: string;
};
const rules = {
  business: 'https://supera.comune.palermo.it/supera/jsp/home.do?sportello=supera',
  building:
    'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:2001-06-06;380',
  safety: 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2008-04-09;81',
  food: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32004R0852',
  trace: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32002R0178',
  allergens: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169',
  moca: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32004R1935',
  privacy: 'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679',
  fiscal: 'https://www.agenziaentrate.gov.it/',
  fire: 'https://www.vigilfuoco.it/',
  environment: 'https://www.rentri.gov.it/',
  labour: 'https://www.ispettorato.gov.it/',
  health: 'https://www.asppalermo.org/',
};
const groups: [string, keyof typeof rules, string][] = [
  [
    'Identità aziendale e rappresentanza',
    'business',
    `
Visura camerale attuale|1|Impresa iscritta|Ragione sociale, attività e unità locali.
Atto costitutivo e statuto|2|Società|Poteri e organizzazione societaria.
Attribuzione partita IVA e codice fiscale|1|Attività economica|Identificazione fiscale del soggetto attuale.
Procure e deleghe del responsabile|1|Presenza di delegati|Ambito dei poteri e soggetti autorizzati.
Documento del titolare o rappresentante|2|Richiesta pertinente|Conservare e condividere solo quanto necessario.
Requisiti professionali per somministrazione|1|Somministrazione|Titoli o esperienza del titolare o preposto.
Nomina e accettazione del preposto|1|Preposto distinto|Collegamento del requisito al soggetto incaricato.
Dichiarazioni requisiti morali e antimafia|2|Procedimento applicabile|Documenti presentati e controlli pertinenti.
PEC, domicilio digitale e recapiti|2|Impresa|Recapiti ufficiali e accesso alle comunicazioni.
Organigramma e deleghe interne|3|Organizzazione volontaria|Referenti per amministrazione, sicurezza e documenti.
`,
  ],
  [
    'Titoli e SCIA',
    'business',
    `
SCIA o titolo di somministrazione|1|Bar e ristorazione|Titolo pertinente all’attività, non un modello universale.
Ricevute di presentazione e protocolli SUAP|1|Pratiche presentate|Data e prova della presentazione.
Licenze e autorizzazioni storiche|1|Attività preesistente|Conservare insieme a modifiche e subingressi.
SCIA o comunicazione di subingresso|1|Cambio gestore|Collegare soggetto precedente e attuale.
Variazioni di attività, superficie e locali|1|Modifiche intervenute|Verificare quali aggiornamenti erano richiesti.
Titolo per vendita al dettaglio o asporto|2|Attività ulteriori|Verificare il regime delle attività effettivamente svolte.
Comunicazioni sospensione e riapertura|2|Interruzioni dell’attività|Ricostruire periodi e adempimenti.
Prescrizioni e provvedimenti dell’autorità|1|Provvedimenti ricevuti|Condizioni operative e termini da far verificare.
Requisiti regionali e comunali aggiuntivi|2|Territorio e zona|Verifica locale aggiornata, inclusa zona tutelata.
Titoli per attività accessorie|2|Tabacchi, giochi o altre attività|Censire solo i titoli delle attività effettive.
`,
  ],
  [
    'Proprietà, locazione e condominio',
    'building',
    `
Titolo di proprietà o provenienza|1|Proprietario|Atto e riferimenti dell’immobile.
Contratto di locazione o comodato|1|Utilizzatore non proprietario|Disponibilità dei locali e destinazione contrattuale.
Registrazione del contratto e proroghe|2|Contratto soggetto a registrazione|Ricevute e variazioni.
Visura catastale|2|Immobile|Intestazione e identificativi; non certifica da sola la regolarità urbanistica.
Planimetria catastale|2|Immobile censito|Confronto con stato dei luoghi e titoli edilizi.
Elaborato planimetrico e subalterni|2|Edificio con parti comuni|Individuazione di unità e pertinenze.
Regolamento condominiale|2|Condominio|Clausole pertinenti e uso delle parti comuni.
Autorizzazioni del proprietario ai lavori|2|Interventi del conduttore|Consensi contrattuali, distinti dai titoli pubblici.
Servitù e diritti di passaggio|2|Situazione presente|Titoli che incidono sull’utilizzo.
Polizze fabbricato e responsabilità|3|Coperture stipulate|Garanzie, esclusioni e scadenze.
`,
  ],
  [
    'Edilizia e agibilità',
    'building',
    `
Titoli edilizi originari e successivi|1|Immobile utilizzato|Licenze, concessioni, permessi e varianti pertinenti.
Pratiche CILA e SCIA edilizie|1|Interventi realizzati|Titoli previsti per gli interventi effettivi.
Agibilità: certificato o segnalazione pertinente|1|Secondo epoca e regime applicabile|Documentazione ed eventuali condizioni.
Destinazione d’uso assentita|1|Uso commerciale o ristorazione|Confronto tecnico tra uso assentito e uso attuale.
Relazione sullo stato legittimo|1|Verifica tecnica dell’immobile|Ricostruzione dei titoli e dei fatti documentati.
Planimetrie assentite e stato attuale|1|Locali dell’attività|Distribuzione, superfici, servizi e pertinenze.
Sanatorie, condoni e relativi esiti|1|Pratiche esistenti|Distinguere istanza, accoglimento e condizioni.
Fine lavori e asseverazioni|2|Interventi conclusi|Collegamento ai titoli e alle opere.
Accessibilità e barriere architettoniche|1|Requisiti applicabili|Relazioni, elaborati e deroghe eventualmente rilasciate.
Verifica requisiti igienico-edilizi|1|Locali aperti al pubblico|Altezze, aerazione, servizi e destinazioni da tecnico.
Fascicolo fotografico datato|3|Supporto documentale|Documentare lo stato dei luoghi, senza sostituire i titoli.
`,
  ],
  [
    'Strutture, vincoli e patrimonio',
    'building',
    `
Progetto strutturale e depositi|1|Opere strutturali|Documentazione depositata presso gli uffici competenti.
Autorizzazioni sismiche pertinenti|1|Interventi soggetti|Regime applicabile a epoca, zona e intervento.
Collaudo statico o documentazione equivalente|1|Quando previsto|Collegamento alle opere e al titolo.
Documentazione di soppalchi e scale|1|Elementi presenti|Titoli, calcoli, carichi e riscontri tecnici.
Relazioni su vulnerabilità o dissesti|2|Criticità rilevate|Valutazioni e interventi prescritti.
Accertamento dei vincoli|1|Area o edificio potenzialmente tutelato|Verifica urbanistica, paesaggistica e culturale.
Autorizzazioni paesaggistiche|1|Opere soggette|Atto, elaborati e condizioni.
Pareri e autorizzazioni Soprintendenza|1|Bene o intervento soggetto|Documenti specifici, non presunti obbligatori per tutti.
Certificazioni di idoneità richieste|2|Caso previsto da norma o provvedimento|Verificare contenuto e competenza del tecnico.
Piano manutenzione dell’immobile|3|Gestione programmata|Interventi e controlli preventivi.
`,
  ],
  [
    'Igiene e HACCP',
    'food',
    `
Registrazione sanitaria e notifica|1|Operatore del settore alimentare|Attività e stabilimento registrati.
Variazioni della notifica sanitaria|1|Modifiche rilevanti|Verificare coerenza con l’attività attuale.
Manuale o piano di autocontrollo|1|Attività alimentare|Procedure proporzionate alle lavorazioni.
Diagrammi e analisi dei pericoli|1|Procedure HACCP|Lavorazioni effettive e misure di controllo.
Registrazioni dei controlli previsti dal piano|1|Secondo piano applicabile|Temperature e altri parametri pertinenti.
Piano e registrazioni pulizia|1|Secondo autocontrollo|Operazioni, prodotti e verifiche.
Monitoraggio infestanti|1|Secondo rischio e piano|Controlli e interventi, anche gestiti internamente ove ammesso.
Gestione non conformità e azioni correttive|1|Problemi rilevati|Tracciabilità delle misure adottate.
Analisi microbiologiche e campionamenti|2|Se richiesti da rischio, piano o autorità|Non presumere periodicità universali.
Riesami e aggiornamenti autocontrollo|2|Modifiche o necessità di riesame|Storico delle versioni e motivazioni.
`,
  ],
  [
    'Alimenti, allergeni e rintracciabilità',
    'trace',
    `
DDT e fatture di acquisto alimenti|1|Acquisti alimentari|Fornitori, prodotti e riferimenti di consegna.
Lotti, etichette e rintracciabilità|1|Secondo prodotto e flusso|Ricostruzione della provenienza e delle destinazioni dovute.
Schede ingredienti e allergeni|1|Preparazioni servite|Aggiornamento quando cambia una ricetta o un ingrediente.
Informazione allergeni al consumatore|1|Somministrazione alimenti|Modalità adeguata al prodotto e al servizio.
Gestione ritiro e richiamo|1|Obblighi applicabili all’operatore|Procedure e registrazioni degli eventi.
Etichette dei prodotti confezionati internamente|1|Confezionamento e vendita|Verificare informazioni richieste per il caso concreto.
Procedure per congelamento e scongelamento|1|Lavorazioni praticate|Parametri e registrazioni previste dal piano.
Trattamenti del pesce destinato al crudo|1|Preparazioni pertinenti|Trattamenti, deroghe applicabili ed evidenze.
Elenco fornitori e recapiti d’emergenza|2|Organizzazione rintracciabilità|Reperibilità e identificazione dei fornitori.
Schede ricetta e revisione menù|2|Preparazioni proprie|Coerenza fra ingredienti, allergeni e descrizioni.
`,
  ],
  [
    'MOCA, acqua e attrezzature alimentari',
    'moca',
    `
Dichiarazioni MOCA ove previste|1|Materiali a contatto con alimenti|Conformità prevista per lo specifico materiale; non un certificato unico.
Schede tecniche e limiti d’uso MOCA|1|Contenitori e utensili utilizzati|Temperature, alimenti ammessi e riutilizzo.
Rintracciabilità acquisto MOCA|2|Materiali e attrezzature|Produttore, fornitore e identificazione.
Schede imballaggi per asporto|1|Asporto o consegna|Idoneità dei materiali alle condizioni d’impiego.
Documentazione dell’acqua utilizzata|1|Preparazioni e servizi alimentari|Origine, impianto interno e valutazione del rischio.
Analisi acqua e ghiaccio|2|Quando previste da rischio o piano|Campionamenti pertinenti, senza scadenze inventate.
Manutenzione filtri, addolcitori e depuratori|1|Apparecchi presenti|Istruzioni, sostituzioni e interventi.
Macchina caffè e attrezzature in pressione|1|Attrezzature presenti|Istruzioni, manutenzione e verifiche eventualmente dovute.
Schede detergenti e disinfettanti|1|Prodotti impiegati|Modalità d’uso e sicurezza, secondo il prodotto.
Prove di idoneità o migrazione specifiche|2|Documentazione prevista o richiesta|Acquisire dal soggetto competente ove pertinente.
`,
  ],
  [
    'Sicurezza sul lavoro',
    'safety',
    `
Documento di valutazione dei rischi|1|Datore di lavoro soggetto|Documento pertinente alle lavorazioni e ai rischi.
Nomina RSPP o svolgimento diretto|1|Obblighi applicabili|Nomina, requisiti e formazione pertinente.
Designazione addetti primo soccorso|1|Organizzazione richiesta|Copertura e formazione.
Designazione addetti antincendio|1|Organizzazione richiesta|Copertura, livello e formazione.
RLS o riferimento RLST|1|Regime applicabile|Eletti o rappresentanza territoriale.
Valutazioni rischi specifici|1|Rischi presenti|Rumore, chimico, movimentazione, stress e altri pertinenti.
DPI: scelta, consegna e istruzioni|1|Rischi che richiedono DPI|Evidenze proporzionate alle mansioni.
DUVRI e coordinamento appalti|1|Appalto con obblighi applicabili|Valutare interferenze ed eventuali esclusioni.
Verbali riunione periodica|2|Quando dovuta|Partecipanti, decisioni e azioni.
Segnalazioni incidenti e quasi incidenti|2|Eventi o gestione preventiva|Ricostruzione dei fatti e miglioramenti.
`,
  ],
  [
    'Personale e formazione',
    'labour',
    `
Contratti e lettere di assunzione|1|Lavoratori impiegati|Posizione e condizioni del rapporto.
Comunicazioni obbligatorie di lavoro|1|Rapporti soggetti|Assunzioni, trasformazioni e cessazioni.
Libro unico del lavoro e disponibilità|1|Soggetti tenuti|Tenuta e modalità di esibizione tramite consulente.
Orari, presenze e riposi|1|Lavoratori impiegati|Documentazione effettiva del rapporto.
Cedolini e prove di pagamento|1|Rapporti di lavoro|Esibizione limitata alla richiesta pertinente.
Formazione sicurezza generale e specifica|1|Lavoratori soggetti|Attestati e aggiornamenti secondo ruolo e regime.
Formazione preposti e dirigenti|1|Ruoli presenti|Requisiti e aggiornamenti da verificare.
Formazione alimentaristi|1|Mansioni e disciplina regionale|Percorsi applicabili in Sicilia.
Formazione primo soccorso e antincendio|1|Addetti designati|Attestati e aggiornamenti pertinenti.
Giudizi di idoneità alla mansione|1|Sorveglianza sanitaria dovuta|Custodire il giudizio pertinente; non le diagnosi cliniche.
Nomina medico competente e protocollo|1|Quando dovuti|Documentazione di competenza del datore e del medico.
Tirocini, apprendistato e lavoro stranieri|2|Rapporti presenti|Documenti specifici del rapporto e titoli pertinenti.
`,
  ],
  [
    'Impianti',
    'building',
    `
Dichiarazioni conformità impianto elettrico|1|Impianto pertinente|Allegati obbligatori e trasformazioni.
Progetto impianto elettrico ove previsto|1|Soglie e casi applicabili|Elaborati e professionista competente.
Dichiarazioni rispondenza ove ammesse|1|Presupposti previsti|Non sostituiscono sempre una dichiarazione mancante.
Documentazione impianto gas|1|Gas presente|Conformità, progetto e allegati pertinenti.
Messa a terra: denuncia e verifiche|1|Obblighi applicabili|Comunicazioni e verifiche periodiche dovute.
Valutazione protezione scariche atmosferiche|1|Quando pertinente|Risultati e adempimenti conseguenti.
Impianto idrico-sanitario|1|Impianti presenti|Conformità e modifiche documentate.
Cappe, estrazione e ventilazione|1|Preparazione alimenti e impianti presenti|Progetti, manutenzione e condizioni d’uso.
Impianti termici e climatizzazione|1|Apparecchi presenti|Libretti e controlli applicabili.
Gas fluorurati e refrigerazione|2|Apparecchiature e soglie pertinenti|Registri, interventi e soggetti abilitati.
Ascensori e montacarichi|1|Impianti presenti|Messa in servizio, manutenzione e verifiche.
`,
  ],
  [
    'Antincendio ed emergenze',
    'fire',
    `
Valutazione rischio incendio|1|Attività con lavoratori|Valutazione nel contesto applicabile.
SCIA antincendio e ricevuta|1|Attività soggetta ai controlli|Verificare assoggettabilità; non tutti i bar sono soggetti.
Valutazione progetto antincendio|1|Categorie e casi previsti|Pareri e conformità del progetto.
Attestazione rinnovo periodico antincendio|1|Attività soggetta|Termine e condizioni del titolo pertinente.
Registro controlli antincendio|1|Misure e obblighi applicabili|Controlli, verifiche e manutenzioni.
Manutenzione estintori e presidi|1|Presidi presenti|Rapporti tecnici e controlli previsti.
Piano emergenza ed evacuazione|1|Casi in cui è obbligatorio|Valutare affollamento, lavoratori e assoggettabilità.
Planimetrie emergenza e vie di esodo|1|Organizzazione e piano pertinenti|Coerenza con lo stato dei luoghi.
Prove evacuazione e addestramento|2|Quando previste|Date, partecipanti e criticità.
Gestione bombole e depositi combustibili|1|Materiali presenti|Valutare quantità, collocazione e regime applicabile.
`,
  ],
  [
    'Dehors e suolo pubblico',
    'business',
    `
Concessione occupazione suolo pubblico|1|Occupazione soggetta|Area, durata e condizioni dell’atto.
Planimetria autorizzata dehors|1|Dehors autorizzato|Ingombri, arredi, passaggi e misure.
Pagamenti canone unico e ricevute|1|Canone dovuto|Periodi e superfici coerenti con il titolo.
Rinnovi, proroghe e variazioni dehors|1|Titolo temporaneo o modificato|Verificare l’effettiva efficacia.
Autorizzazioni edilizie degli elementi|1|Opere che le richiedono|Pedane, coperture, chiusure e strutture.
Pareri vincoli e Soprintendenza dehors|1|Area o bene tutelato|Condizioni specifiche dell’autorizzazione.
Documentazione strutturale dehors|1|Strutture che la richiedono|Calcoli, ancoraggi e stabilità.
Autorizzazioni insegne e mezzi pubblicitari|1|Installazioni soggette|Titoli e tributi pertinenti.
Consensi di proprietari e condominio|2|Spazi o beni coinvolti|Diritti privati distinti dai titoli pubblici.
Fotografie e rilievi periodici|3|Gestione preventiva|Confronto tra stato autorizzato ed effettivo.
`,
  ],
  [
    'Ambiente, rifiuti e rumore',
    'environment',
    `
Valutazione impatto acustico o dichiarazione pertinente|1|Attività e impianti soggetti|Regime applicabile da tecnico competente.
Autorizzazioni e deroghe acustiche|1|Attività che le richiedono|Limiti, tempi e condizioni.
Titolo scarichi e autorizzazioni pertinenti|1|Scarichi soggetti|Rete, tipologia e prescrizioni.
Emissioni in atmosfera e AUA|1|Impianti o attività soggetti|Verificare esclusioni e titoli applicabili.
Manutenzione separatori grassi|2|Impianti presenti|Interventi e smaltimenti pertinenti.
Conferimento oli alimentari esausti|1|Produzione di oli esausti|Tracciabilità di raccolta e destinazione.
Classificazione e gestione rifiuti|1|Rifiuti prodotti|Flussi, depositi e soggetti autorizzati.
FIR, registri e RENTRI|1|Obblighi applicabili al soggetto e ai rifiuti|Verificare iscrizione, modalità e termini vigenti.
Dichiarazioni MUD|2|Soggetti obbligati|Dati e ricevute dell’anno pertinente.
TARI e dichiarazioni delle superfici|2|Occupazione dei locali|Posizione, variazioni e pagamenti.
`,
  ],
  [
    'Fisco, fatture e registratore telematico',
    'fiscal',
    `
Anagrafica fiscale e regime adottato|1|Attività economica|Dati validati con il commercialista.
Registratore telematico: censimento e attivazione|1|Uso del registratore|Matricola, stato e documentazione.
Verifiche periodiche RT|1|Apparecchio utilizzato|Interventi del tecnico e scadenze applicabili.
QR identificativo del registratore|1|Apparecchio soggetto|Esposizione e collegamento allo stato del dispositivo.
Corrispettivi telematici e ricevute|1|Obblighi applicabili|Trasmissioni, esiti e anomalie.
Procedure guasti e mancato funzionamento|1|Registratore o trasmissioni indisponibili|Adempimenti da verificare nel caso concreto.
Fatture elettroniche e ricevute SDI|1|Operazioni soggette|File originali ed esiti del sistema.
Conservazione delle fatture elettroniche|1|Soggetti tenuti|Servizio e riscontri della conservazione prevista.
Registri IVA e documentazione contabile|1|Regime applicabile|Reperibilità presso impresa o professionista.
POS e collegamenti fiscali richiesti|1|Strumenti utilizzati e disciplina vigente|Configurazione e riscontri da verificare col consulente.
Inventari e documenti di magazzino|2|Regime e organizzazione|Consistenza e movimenti documentati.
`,
  ],
  [
    'Clienti, prezzi, musica e attività accessorie',
    'business',
    `
Listini e prezzi esposti|1|Vendita e somministrazione|Coerenza fra prezzi comunicati e applicati.
Menù e informazioni obbligatorie|1|Somministrazione|Descrizioni, allergeni e ulteriori informazioni pertinenti.
Orari e comunicazioni al pubblico|2|Obblighi locali applicabili|Esposizione e comunicazioni richieste.
Segnaletica divieto fumo|1|Locali interessati|Indicazioni previste e responsabile ove richiesto.
Alcol: titoli fiscali e adempimenti pertinenti|1|Vendita o somministrazione alcolici|Verificare regime, esenzioni e prescrizioni.
Tabelle e dispositivi per consumo alcolici|1|Orari e casi previsti|Verificare esatta applicabilità.
Licenze musica SIAE e diritti connessi|1|Utilizzo di repertorio protetto|Licenze richieste per il tipo d’uso.
Canone speciale apparecchi riceventi|2|Apparecchi soggetti presenti|Verificare presupposti ed esenzioni.
Titoli pubblico spettacolo e trattenimenti|1|Eventi soggetti|Autorizzazioni, sicurezza e capienza pertinenti.
Giochi, apparecchi e tabella giochi proibiti|1|Attività e apparecchi presenti|Titoli e prescrizioni specifici.
Gestione reclami e standard di servizio|3|Organizzazione volontaria|Procedure di miglioramento.
`,
  ],
  [
    'Privacy e sistemi digitali',
    'privacy',
    `
Informative clienti, lavoratori e fornitori|1|Trattamenti effettuati|Finalità, basi giuridiche e informazioni pertinenti.
Registro attività di trattamento ove dovuto|1|Presupposti applicabili|Dati, finalità, destinatari e misure.
Nomine e contratti dei responsabili|1|Fornitori che trattano dati per l’impresa|Accordi e istruzioni pertinenti.
Autorizzazioni del personale e accessi|1|Persone che trattano dati|Permessi coerenti con le mansioni.
Documentazione videosorveglianza|1|Impianto presente|Finalità, cartelli, informativa e tempi.
Accordo o autorizzazione art. 4 ove dovuti|1|Controlli a distanza soggetti|Valutare l’impianto e la presenza di lavoratori.
Valutazione impatto e bilanciamento ove necessari|1|Trattamenti che li richiedono|Analisi specifica, non modelli generici.
Politiche conservazione e cancellazione|1|Trattamenti effettuati|Tempi differenziati e loro applicazione.
Registro violazioni dei dati personali|1|Incidenti rilevati|Valutazioni e notifiche eventualmente dovute.
Backup, ripristino e sicurezza|2|Sistemi digitali|Misure proporzionate e prove di recupero.
Procedura registrazione controlli con Presidio|1|Utilizzo del sistema|Base giuridica, contesto, conservazione e fornitori.
`,
  ],
  [
    'Verbali, legale e assicurazioni',
    'business',
    `
Verbali di accesso, ispezione e contestazione|1|Controlli effettuati|Originali completi e allegati.
Notifiche PEC e ricevute di consegna|1|Atti ricevuti o inviati|Date rilevanti da verificare col legale.
Prescrizioni, diffide e ordini|1|Provvedimenti emessi|Contenuto, termini e riscontri.
Prove di adempimento alle prescrizioni|1|Attività correttive eseguite|Documenti, protocolli e verifiche.
Memorie, osservazioni e istanze|2|Procedimenti in corso|Testi inviati e prove di deposito.
Ricorsi, sentenze e provvedimenti cautelari|1|Contenzioso presente|Stato, effetti e termini da professionista.
Accessi agli atti e documenti acquisiti|2|Ricostruzione del fascicolo|Richieste, esiti e originali ottenuti.
Incarichi e deleghe ai professionisti|2|Assistenza professionale|Ambito degli incarichi e recapiti.
Polizze RC, tutela legale e rischi d’impresa|2|Coperture previste o stipulate|Verificare obblighi specifici, massimali ed esclusioni.
Registrazioni, trascrizioni e manifest degli allegati|2|Controlli registrati lecitamente|Originali separati da trascrizioni e valutazioni.
Perizie e consulenze tecniche|2|Questioni che le richiedono|Autore, data, documenti esaminati e conclusioni.
Registro interno dei controlli|3|Organizzazione volontaria|Storico e azioni di miglioramento.
`,
  ],
];
const optionalSupports: Record<string, string> = {
  'Titoli e SCIA':
    'Cronologia riepilogativa dei titoli|3|Supporto organizzativo volontario|Mappa dei titoli e delle variazioni; non sostituisce le ricevute e gli originali.',
  'Igiene e HACCP':
    'Certificazioni volontarie di sicurezza alimentare|3|Adesione a schemi volontari|Certificato, campo di applicazione e rapporti di audit, se adottati.',
  'Alimenti, allergeni e rintracciabilità':
    'Certificazioni volontarie di prodotto o filiera|3|Adesione volontaria|Conservare evidenze e limiti delle certificazioni effettivamente dichiarate.',
  'MOCA, acqua e attrezzature alimentari':
    'Inventario fotografico delle attrezzature alimentari|3|Supporto organizzativo volontario|Foto, ubicazione e collegamenti ai documenti dei singoli beni.',
  'Sicurezza sul lavoro':
    'Certificazione volontaria del sistema di sicurezza|3|Sistema certificato volontario|Certificato e audit; non sostituiscono gli obblighi di sicurezza.',
  'Personale e formazione':
    'Piano volontario di welfare aziendale|3|Piano adottato|Regole, adesioni e documenti pertinenti, con accesso riservato.',
  Impianti:
    'Inventario digitale e piano migliorie degli impianti|3|Supporto volontario ulteriore ai registri dovuti|Elenco asset e proposte del tecnico; non sostituisce dichiarazioni e verifiche.',
  'Antincendio ed emergenze':
    'Rapporti di esercitazioni aggiuntive volontarie|3|Attività ulteriori rispetto agli obblighi applicabili|Esiti e miglioramenti delle prove extra effettuate.',
  'Ambiente, rifiuti e rumore':
    'Certificazione ambientale volontaria|3|Adesione volontaria|Certificati e audit ambientali, se adottati.',
  'Fisco, fatture e registratore telematico':
    'Cruscotto volontario di controllo di gestione|3|Gestione interna|Report e riconciliazioni ulteriori rispetto agli adempimenti dovuti.',
  'Privacy e sistemi digitali':
    'Rapporto volontario di verifica indipendente|3|Revisione volontaria ulteriore agli obblighi|Esame delle misure e piano di miglioramento senza dichiarazioni automatiche di conformità.',
};
for (const group of groups) {
  const support = optionalSupports[group[0]];
  if (support) group[2] = group[2].trim() + '\n' + support;
}
export const catalogue: CatalogItem[] = groups.flatMap(([category, source, rows], g) =>
  rows
    .trim()
    .split('\n')
    .map((line, i) => {
      const [title, p, condition, description] = line.split('|');
      return {
        id: `cat-${g + 1}-${i + 1}`,
        category,
        title,
        priority: ({ '1': 'Prioritario', '2': 'Secondario', '3': 'Opzionale' } as const)[
          p as '1' | '2' | '3'
        ],
        condition,
        description,
        source: /allergen/i.test(title) ? rules.allergens : rules[source],
      };
    }),
);
export const catalogueCategories = groups.map(x => x[0]);
