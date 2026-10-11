// Snapshot documentale: non determina automaticamente gli obblighi dell'impresa.
export const catalogueResearchDate='2026-09-21';
export type CatalogueSource={id:string;title:string;url:string;reference:string;scope:string;note:string};
export type InspectionItem={id:string;title:string;category:string;description:string;condition:string;priority:string;source:string;sourceIds:string[];aliases:string[];area:string;territory:string;basis:'Fonte consultata'|'Da approfondire'|'Catalogo precedente';checkedOn:string;};
export const catalogueSources:CatalogueSource[]=[
 {id:'co',title:'Ministero del Lavoro · comunicazioni obbligatorie',url:'https://www.co.lavoro.gov.it/',reference:'Comunicazioni di instaurazione e variazione dei rapporti',scope:'Italia',note:'Conservare comunicazioni e ricevute pertinenti; modello e termini dipendono dal rapporto.'},
 {id:'garante',title:'Garante · FAQ registro dei trattamenti',url:'https://www.garanteprivacy.it/home/faq/registro-delle-attivita-di-trattamento',reference:'FAQ 2: soggetti obbligati',scope:'Italia',note:'La FAQ include bar e ristoranti con almeno un dipendente. La soglia di 250 dipendenti non è una generale esenzione.'},
 {id:'suap',title:'Comune di Palermo · procedimenti SUAP',url:'https://supera.comune.palermo.it/supera/pu/push-tabella-informativa-consultazione.do?S=30&nomeTabella=FOSAP_INFORMATIVA',reference:'Somministrazione, notifica sanitaria, OSP, alcolici',scope:'Palermo',note:'Modulistica consultata; verificare procedimento, zona e regolamenti alla data della pratica.'},
 {id:'edilizia',title:'Comune di Palermo · norme e modulistica',url:'https://supera.comune.palermo.it/supera/pu/push-tabella-norme-regolamenti-hp.do?S=90&nomeTabella=FOUTNSAP_NORMEREGOLAMENTI',reference:'Titoli edilizi e agibilità; disciplina regionale',scope:'Palermo / Sicilia',note:'Titoli alternativi secondo epoca e interventi. La planimetria catastale non dimostra da sola la regolarità urbanistica.'},
 {id:'ri',title:'Registro Imprese · visura e certificato',url:'https://www.registroimprese.it/visura-camerale-ordinaria-storica-e-certificato',reference:'Identità, sede, cariche e vicende dell’impresa',scope:'Italia',note:'Documenti di riscontro; non sostituiscono i titoli dell’attività.'},
 {id:'haccp',title:'EUR-Lex · Reg. 852/2004',url:'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32004R0852',reference:'Artt. 5–6; allegato II',scope:'UE',note:'Procedure e registrazioni proporzionate all’attività. Non occorre necessariamente un registro separato per ogni voce; formazione da integrare con le regole regionali.'},
 {id:'trace',title:'EUR-Lex · Reg. 178/2002',url:'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32002R0178',reference:'Artt. 18–19',scope:'UE',note:'Rintracciabilità e gestione di ritiro/richiamo; documentazione pertinente a prodotti e fornitori.'},
 {id:'allergeni',title:'EUR-Lex · Reg. 1169/2011',url:'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32011R1169',reference:'Artt. 9, 14, 21, 44; allegato II',scope:'UE',note:'Informazione alimentare anche per somministrazione e vendita a distanza; integrare le modalità nazionali applicabili.'},
 {id:'moca',title:'EUR-Lex · Reg. 1935/2004',url:'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32004R1935',reference:'Artt. 16–17',scope:'UE',note:'Dichiarazione di conformità secondo le misure specifiche del materiale; non richiesta indistintamente per ogni oggetto.'},
 {id:'safety',title:'INL · Testo unico salute e sicurezza',url:'https://www.ispettorato.gov.it/documenti-e-normativa/normativa-di-interesse/salute-e-sicurezza-nei-luoghi-di-lavoro/',reference:'D.Lgs. 81/2008; edizione INL gennaio 2026',scope:'Italia',note:'Applicabilità secondo lavoratori, ruoli, rischi e attrezzature. Durate della formazione e scadenze richiedono verifica del caso concreto.'},
 {id:'impianti',title:'Gazzetta Ufficiale · DM 37/2008',url:'https://www.gazzettaufficiale.it/eli/id/2008/03/12/008G0060/sg',reference:'Art. 7: dichiarazione e allegati; art. 5: progetto',scope:'Italia',note:'Testo originario consultato. La DiRi è alternativa solo alle condizioni dell’art. 7, comma 6; non una sanatoria universale.'},
 {id:'fire',title:'Vigili del Fuoco · procedure di prevenzione incendi',url:'https://www.vigilfuoco.it/servizi-le-aziende-e-i-professionisti/prevenzione-incendi/testi-coordinati-di-prevenzione-incendi-procedure',reference:'DPR 151/2011; DM 7 agosto 2012',scope:'Italia',note:'SCIA, valutazione progetto e rinnovo dipendono dall’assoggettabilità e dalla categoria. Un ristorante non è automaticamente attività soggetta.'},
 {id:'noise',title:'ARPA Veneto · DPR 227/2011, disciplina nazionale',url:'https://www.arpa.veneto.it/temi-ambientali/rumore/normativa/nazionale/aggiornamento-normativo-dpr-227-del-2011.pdf/@@download/file',reference:'Art. 4; legge 447/1995, art. 8',scope:'Italia',note:'Esclusioni e semplificazioni dipendono da sorgenti sonore e limiti. Consultare anche classificazione acustica e disposizioni comunali.'},
 {id:'aua',title:'Gazzetta Ufficiale · DPR 59/2013',url:'https://www.gazzettaufficiale.it/atto/serie_generale/caricaDettaglioAtto/originario?atto.codiceRedazionale=13G00101&atto.dataPubblicazioneGazzetta=2013-05-29&elenco30giorni=false',reference:'Art. 3: titoli ambientali ricompresi',scope:'Italia',note:'Verificare scarichi, emissioni, esclusioni e regole regionali; non tutte le attività richiedono AUA.'},
 {id:'waste',title:'RENTRI · regole e servizi',url:'https://www.rentri.gov.it/',reference:'Tracciabilità rifiuti; formulari e registri',scope:'Italia',note:'Valutare tipologia di rifiuti, dimensione e regime; gli adempimenti non sono uniformi per tutti i ristoranti.'},
 {id:'waste2026',title:'RENTRI · esclusioni aggiornate dalla legge 199/2025',url:'https://www.rentri.gov.it/news/cancellazione-dei-soggetti-esclusi-dalla-legge-30-dicembre-2025-n-199',reference:'Art. 188-bis, comma 3-bis, D.Lgs. 152/2006',scope:'Italia',note:'La fonte segnala modifiche del perimetro e cancellazioni; non presumere obbligo di iscrizione.'},
 {id:'privacy',title:'EUR-Lex · Reg. 2016/679',url:'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32016R0679',reference:'Artt. 5, 13, 28–30, 32–35',scope:'UE',note:'Documentazione proporzionata ai trattamenti. Registro e DPIA secondo le condizioni previste, non per la sola apertura del locale.'},
 {id:'cctv',title:'INL · servizi ai datori di lavoro',url:'https://www.ispettorato.gov.it/',reference:'Autorizzazione per impianti di controllo',scope:'Italia',note:'Per videosorveglianza con possibile controllo dei lavoratori, valutare accordo sindacale o autorizzazione ai sensi dell’art. 4 dello Statuto.'},
 {id:'lul',title:'Ministero del Lavoro · circolare 20/2008',url:'https://www.lavoro.gov.it/_layouts/Lavoro.Web/AppPages/GetResource?ds=oil&rid=1448',reference:'Libro unico del lavoro',scope:'Italia',note:'Fonte storica sul LUL; disciplina attuale e altri documenti del personale da verificare con il consulente del lavoro.'},
 {id:'rt',title:'Agenzia delle Entrate · registratori telematici',url:'https://www.agenziaentrate.gov.it/portale/misuratori-fiscali-e-registratori-telematici/infogen-misuratori-fiscali-e-registratori-telematici-imprese',reference:'Memorizzazione delle operazioni',scope:'Italia',note:'Riscontro nell’indice ufficiale; pagina completa non accessibile durante la ricerca. Dettagli operativi da riesaminare.'},
 {id:'controls',title:'EUR-Lex · Reg. 2017/625',url:'https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32017R0625',reference:'Artt. 13–15: controlli ufficiali',scope:'UE',note:'Accesso a documenti e sistemi nella misura necessaria al controllo; non giustifica condivisione indiscriminata dell’archivio.'}
];
type Row=[string,string,string,string?,string?];
function group(area:string,sourceIds:string[],rows:Row[],territory='Italia',basis:InspectionItem['basis']='Fonte consultata'):InspectionItem[]{
 return rows.map(([key,title,condition,aliases='',reference=''])=>({id:'is26-'+key,title,area,category:'Altro',description:title,condition,priority:'Prioritario',sourceIds,source:sourceIds.map(id=>catalogueSources.find(s=>s.id===id)!.title).join('; ')+(reference?' · '+reference:''),aliases:aliases.split('|').filter(Boolean),territory,basis,checkedOn:catalogueResearchDate}));
}
export const inspectionCatalogue:InspectionItem[]=[
 ...group('Impresa e titoli',['ri'],[
 ['visura','Visura camerale','Riscontro dell’impresa attuale.','visura ordinaria|visura storica|camera di commercio'],
 ['atto','Atto societario e cariche','Se società; riscontro rappresentanza.','atto costitutivo|statuto societario'],
 ]),
 ...group('Impresa e titoli',['suap'],[
 ['scia','SCIA / autorizzazione somministrazione','Secondo zona e procedimento.','scia somministrazione|autorizzazione somministrazione'],
 ['ricevuta-suap','Ricevuta e protocollo SUAP','Per la pratica presentata.','ricevuta suap|protocollo suap'],
 ['subingresso','Subingresso e variazioni attività','Se intervenuti.','subingresso|variazione attivita'],
 ['requisiti','Requisiti professionali e morali','Secondo procedimento e ruolo.','requisiti professionali|attestato sab|requisiti morali'],
 ['notifica','Notifica sanitaria e registrazione','Per attività alimentare.','notifica sanitaria|registrazione sanitaria|registrazione osa'],
 ['alcolici','Denuncia e licenza alcolici','Se vendita/somministrazione soggetta.','licenza alcolici|denuncia alcolici|licenza fiscale alcolici'],
 ['procura','Procura e delega SUAP','Se rappresentanza.','procura suap|delega suap'],
 ],'Palermo'),
 ...group('Locali e urbanistica',['edilizia'],[
 ['agibilita','Agibilità / segnalazione certificata','Secondo immobile ed epoca.','agibilita|abitabilita|segnalazione certificata agibilita'],
 ['titolo-edilizio','Titoli edilizi e varianti','Secondo lavori ed epoca.','permesso di costruire|concessione edilizia|cila|scia edilizia'],
 ['planimetria','Planimetria dei locali','Elaborato della pratica pertinente.','planimetria locali|planimetria stato attuale'],
 ['destinazione','Destinazione d’uso','Verifica tecnica dell’uso assentito.','destinazione uso|cambio destinazione'],
 ['catasto','Planimetria catastale','Solo riscontro catastale.','planimetria catastale|visura catastale'],
 ['barriere','Accessibilità e barriere architettoniche','Secondo immobile/intervento.','barriere architettoniche|relazione accessibilita'],
 ],'Palermo / Sicilia'),
 ...group('Dehors e occupazioni',['suap'],[
 ['osp','Concessione occupazione suolo pubblico','Se occupazione soggetta.','concessione suolo pubblico|concessione dehors|occupazione suolo pubblico'],
 ['osp-plan','Planimetria e perizia dehors','Secondo pratica OSP.','planimetria dehors|perizia dehors|perizia osp'],
 ['osp-canone','Canone e ricevute OSP','Secondo concessione.','canone unico|canone occupazione|ricevuta osp'],
 ['insegna','Titolo per insegne e tende','Se previsto per installazione.','autorizzazione insegna|autorizzazione tenda'],
 ],'Palermo'),
 ...group('Igiene e autocontrollo',['haccp'],[
 ['haccp','Piano di autocontrollo HACCP','Attività alimentare; proporzionato.','manuale haccp|piano haccp|piano autocontrollo'],
 ['temperature','Registrazioni temperature','Se previste dall’autocontrollo.','registro temperature|scheda temperature'],
 ['pulizie','Piano e registrazioni pulizie','Secondo autocontrollo.','piano pulizie|registro pulizie|piano sanificazione'],
 ['infestanti','Monitoraggio infestanti','Secondo autocontrollo.','pest control|derattizzazione|disinfestazione'],
 ['acqua','Controlli acqua e ghiaccio','Secondo approvvigionamento e rischio.','analisi acqua|potabilita acqua|analisi ghiaccio'],
 ['formazione-alimenti','Formazione alimentaristi','Secondo mansioni e regole regionali.','attestato alimentarista|formazione alimentaristi|attestato haccp'],
 ['abbattimento','Procedura e registrazioni abbattimento','Se lavorazione effettuata.','registro abbattimento|procedura abbattimento'],
 ['sottovuoto','Procedura sottovuoto e conservazione','Se lavorazione effettuata.','procedura sottovuoto|conservazione sottovuoto'],
 ['trasporto','Procedura trasporto alimenti','Se trasporto/delivery.','trasporto alimenti|procedura delivery'],
 ['nonconformita','Non conformità e azioni correttive HACCP','Se riscontrate.','non conformita haccp|azioni correttive haccp'],
 ['analisi','Analisi alimenti e superfici','Secondo rischi e piano.','analisi microbiologica|tamponi superfici'],
 ]),
 ...group('Tracciabilità e alimenti',['trace'],[
 ['ddt','DDT e fatture fornitori alimentari','Per rintracciabilità delle forniture.','documento di trasporto|ddt|fattura fornitore alimentare'],
 ['lotti','Lotti ed etichette delle materie prime','Collegare alle forniture utilizzate.','registro lotti|etichetta lotto'],
 ['fornitori','Elenco e riferimenti fornitori','Per identificare la provenienza.','elenco fornitori|anagrafica fornitori'],
 ['ritiro','Procedura ritiro e richiamo','Per gestione alimenti non sicuri.','procedura richiamo|procedura ritiro'],
 ['richiamo','Comunicazioni di allerta / richiamo','Se ricevute o emesse.','avviso richiamo|allerta alimentare'],
 ]),
 ...group('Allergeni e informazione',['allergeni'],[
 ['allergeni','Menu e registro allergeni','Informazioni per alimenti somministrati.','registro allergeni|menu allergeni|tabella allergeni'],
 ['ricette','Schede ingredienti e ricette','Supporto all’informazione allergeni.','scheda ingredienti|scheda ricetta'],
 ['etichette','Etichette prodotti preimballati','Se commercializzati.','etichetta prodotto|etichettatura alimentare'],
 ['menu-online','Informazioni alimentari vendita a distanza','Se ordini online/delivery.','allergeni online|menu delivery'],
 ]),
 ...group('Materiali a contatto alimentare',['moca'],[
 ['moca','Dichiarazioni MOCA','Secondo materiale e misura specifica.','dichiarazione moca|conformita moca|materiali contatto alimenti'],
 ['moca-trace','Forniture e identificazione MOCA','Per rintracciabilità.','rintracciabilita moca|lotto moca'],
 ]),
 ...group('Sicurezza sul lavoro',['safety'],[
 ['dvr','Documento valutazione rischi','Se datore di lavoro soggetto.','dvr|documento valutazione rischi'],
 ['rspp','Nomina e formazione RSPP','Secondo organizzazione.','nomina rspp|attestato rspp'],
 ['rls','RLS / RLST','Secondo rappresentanza.','nomina rls|elezione rls|rlst'],
 ['formazione-sicurezza','Formazione sicurezza lavoratori','Secondo ruoli e rischi.','formazione generale lavoratori|formazione specifica lavoratori'],
 ['preposti','Nomina e formazione preposti','Se presenti.','nomina preposto|formazione preposti'],
 ['emergenze','Addetti emergenze e formazione','Secondo organizzazione.','addetto antincendio|addetto primo soccorso'],
 ['piano-emergenza','Piano emergenza ed evacuazione','Nei casi previsti.','piano emergenza|piano evacuazione'],
 ['medico','Nomina medico competente','Se richiesta.','nomina medico competente'],
 ['idoneita','Giudizi idoneità alla mansione','Se sorveglianza prevista; senza cartelle cliniche.','giudizio idoneita|idoneita mansione'],
 ['dpi','Consegna e addestramento DPI','Secondo rischi.','consegna dpi|addestramento dpi'],
 ['duvri','DUVRI e cooperazione appalti','Se interferenze e obbligo.','duvri|rischi interferenze'],
 ['attrezzature','Manuali e verifiche attrezzature','Secondo attrezzature.','manuale attrezzatura|verifica attrezzatura'],
 ['terra','Verifiche impianto di terra','Secondo regime applicabile.','verifica messa terra|verifica impianto terra'],
 ]),
 ...group('Impianti',['impianti'],[
 ['elettrico','Conformità impianto elettrico','Per impianto e lavori pertinenti.','conformita impianto elettrico|dico elettrico'],
 ['gas','Conformità impianto gas','Se presente.','conformita impianto gas|dico gas'],
 ['idrico','Conformità impianto idrico','Per impianto e lavori pertinenti.','conformita impianto idrico|dico idrico'],
 ['clima','Conformità impianto climatizzazione','Se presente.','conformita climatizzazione|dico climatizzazione'],
 ['progetto-impianti','Progetti e allegati impianti','Secondo intervento e soglie.','progetto impianto|allegati obbligatori dico'],
 ['diri','Dichiarazione rispondenza impianto','Solo condizioni art. 7, comma 6.','dichiarazione rispondenza|diri'],
 ]),
 ...group('Prevenzione incendi',['fire'],[
 ['assoggettabilita','Valutazione assoggettabilità antincendio','Secondo impianti, depositi e attività.','assoggettabilita antincendio'],
 ['scia-incendi','SCIA antincendio e ricevuta','Se attività soggetta.','scia antincendio|scia prevenzione incendi'],
 ['progetto-incendi','Valutazione progetto antincendio','Per categorie previste.','valutazione progetto antincendio'],
 ['rinnovo-incendi','Rinnovo periodico antincendio','Secondo pratica.','rinnovo antincendio|rinnovo conformita antincendio'],
 ['asseverazione','Asseverazioni e certificazioni antincendio','Secondo pratica.','asseverazione antincendio|certificazione antincendio'],
 ]),
 ...group('Ambiente e rumore',['noise'],[
 ['acustica','Valutazione impatto acustico','Secondo musica, sorgenti e limiti.','impatto acustico|relazione acustica'],
 ['acustica-dich','Dichiarazione sostitutiva acustica','Solo nei casi ammessi.','dichiarazione acustica'],
 ]),
 ...group('Ambiente e rumore',['aua'],[
 ['aua','Autorizzazione unica ambientale','Se ricorrono i presupposti.','autorizzazione unica ambientale|aua'],
 ['scarichi','Titolo / documentazione scarichi','Secondo scarichi e disciplina locale.','autorizzazione scarichi'],
 ['emissioni','Titolo / documentazione emissioni','Secondo impianti e regime.','autorizzazione emissioni'],
 ]),
 ...group('Rifiuti',['waste','waste2026'],[
 ['oli','Conferimenti oli alimentari esausti','Se prodotti; regime applicabile.','oli esausti|olio alimentare esausto'],
 ['fir','Formulari e attestazioni conferimento','Quando previsti.','formulario rifiuti|formulario identificazione rifiuti'],
 ['registro-rifiuti','Registro carico e scarico rifiuti','Solo soggetti obbligati.','registro carico scarico rifiuti'],
 ['rentri','Iscrizione / valutazione esclusione RENTRI','Secondo perimetro aggiornato.','iscrizione rentri|esclusione rentri'],
 ]),
 ...group('Privacy e videosorveglianza',['privacy','garante'],[
 ['informative','Informative privacy','Per trattamenti effettuati.','informativa privacy|informativa trattamento dati'],
 ['registro-privacy','Registro trattamenti','Anche bar/ristoranti con dipendenti; valutare trattamenti.','registro trattamenti'],
 ['responsabili','Accordi responsabili trattamento','Se fornitori nel ruolo.','responsabile trattamento|accordo art 28'],
 ['istruzioni','Autorizzazioni e istruzioni privacy','Per persone autorizzate.','istruzioni privacy|autorizzati trattamento'],
 ['sicurezza-dati','Misure sicurezza e conservazione dati','Secondo rischi e finalità.','politica conservazione dati|misure sicurezza dati'],
 ['dpia','Valutazione impatto privacy','Se elevato rischio.','dpia|valutazione impatto privacy'],
 ['data-breach','Registro e gestione violazioni dati','Se violazioni; artt. 33–34.','data breach|violazione dati personali'],
 ['cctv-info','Informativa videosorveglianza','Se impianto attivo.','informativa videosorveglianza|cartello videosorveglianza'],
 ]),
 ...group('Privacy e videosorveglianza',['cctv'],[
 ['cctv-lavoro','Accordo / autorizzazione telecamere','Se possibile controllo lavoratori.','autorizzazione videosorveglianza|accordo videosorveglianza'],
 ]),
 ...group('Personale e paghe',['lul'],[
 ['lul','Libro unico del lavoro','Se datore soggetto.','libro unico lavoro|lul'],
 ['presenze','Presenze e prospetti paga','Per rapporti interessati.','registro presenze|cedolino|busta paga'],
 ]),
 ...group('Personale e paghe',['co'],[
 ['unilav','UNILAV e ricevute comunicazioni','Per rapporti soggetti.','unilav|comunicazione assunzione|comunicazione obbligatoria'],
 ['variazioni-lavoro','Proroghe, trasformazioni e cessazioni','Se intervenute.','proroga contratto|trasformazione rapporto|cessazione rapporto'],
 ]),
 ...group('Personale e paghe',['lul','safety'],[
 ['contratti','Contratti e informazioni ai lavoratori','Secondo rapporto; riesame del consulente.','contratto lavoro|lettera assunzione'],
 ['versamenti','Versamenti contributivi e assicurativi','Secondo posizioni; riesame del consulente.','versamento contributi|premio inail|f24 contributi'],
 ],'Italia','Da approfondire'),
 ...group('Prevenzione incendi',['safety'],[
 ['registro-incendi','Registro controlli antincendio','Secondo disciplina del luogo di lavoro.','registro controlli antincendio'],
 ['estintori','Rapporti manutenzione estintori','Per presidi presenti.','manutenzione estintori|controllo estintori'],
 ]),
 ...group('Eventi e intrattenimento',['fire','suap'],[
 ['spettacolo','Titolo pubblico spettacolo','Se evento/attività soggetti.','licenza pubblico spettacolo|scia pubblico spettacolo'],
 ['agibilita-spettacolo','Agibilità pubblico spettacolo','Se prevista; distinta dall’agibilità edilizia.','agibilita pubblico spettacolo'],
 ],'Palermo'),
 ...group('Fisco e corrispettivi',['rt'],[
 ['rt','Registratore telematico e censimento','Se utilizzato; dettagli da verificare.','registratore telematico|censimento rt'],
 ['corrispettivi','Ricevute trasmissione corrispettivi','Secondo regime fiscale.','corrispettivi telematici|trasmissione corrispettivi'],
 ],'Italia','Da approfondire'),
 ...group('Verbali e controlli',['controls'],[
 ['verbale','Verbali di controllo','Se controlli effettuati.','verbale controllo|verbale ispezione|verbale sopralluogo'],
 ['prescrizioni','Prescrizioni e riscontri','Se emessi; collegare alle scadenze.','prescrizione sanitaria|riscontro prescrizioni'],
 ['campionamento','Verbali prelievo e risultati','Se campionamenti effettuati.','verbale prelievo|verbale campionamento'],
 ['rettifiche','Comunicazioni e documenti integrativi','Se richiesti nel controllo.','integrazione documentale|risposta richiesta documenti'],
 ])
];
