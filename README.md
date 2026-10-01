# Riepilogo busta paga

Applicazione Angular con una sola pagina: carichi il cedolino in PDF e ottieni il riepilogo
grafico a schede (lordo, trattenute, netto, ferie, TFR) come file PDF da scaricare.

Tutto avviene nel browser. Il cedolino non viene caricato su nessun server, non passa da
nessuna rete e non viene scritto su disco: contiene codice fiscale, IBAN e retribuzione, e
non c'è motivo di farlo uscire dal tuo computer. Non serve un backend.

## Pubblicare

Le istruzioni passo passo per metterla online gratuitamente su GitHub Pages e il messaggio da
mandare a chi la userà sono in **[PUBBLICARE.md](PUBBLICARE.md)**.

Due dettagli tecnici che quella guida dà per fatti. Il sito vive in una sottocartella
(`/nome-repository/`), quindi la compilazione passa `--base-href` e `index.html` contiene un tag
`<base>`: senza, il browser cercherebbe gli asset nella radice del dominio. Per lo stesso motivo il
worker di pdf.js non si carica da un percorso relativo ma da `new URL(..., document.baseURI)`.

I controlli automatici girano anche in integrazione continua, dove i fixture non esistono perché
contengono dati personali: in quel caso si dichiarano saltati invece di fallire, e restano attivi
quelli che non dipendono da un cedolino vero (`test:tokenizzazione`, `test:segnalazione`).

## Avvio

```bash
npm install
npm start
```

Poi apri http://localhost:4200 e trascina il cedolino nella pagina.

Se `npm install` dà problemi con le versioni, il percorso più sicuro è generare un progetto
pulito e trapiantarci il codice:

```bash
ng new cedolino-app --style=css --ssr=false
cd cedolino-app
npm install pdfjs-dist pdf-lib
```

poi copia dentro `src/app/` e `src/main.ts` di questo progetto, e aggiungi in `angular.json`
la voce `assets` che copia il worker di pdf.js (vedi il file incluso qui).

## Come funziona

Tre fasi, una per servizio, nell'ordine in cui le chiama `CedolinoService`.

**1. Estrazione** (`core/pdf-text.service.ts`). pdf.js restituisce i frammenti di testo con le
loro coordinate. Il testo piatto non basta: un cedolino non è un documento strutturato, è una
griglia di etichette e numeri posizionati a coordinate assolute, e senza le coordinate non si
distingue un importo nella colonna "competenze" da uno nella colonna "trattenute".

**2. Parsing** (`core/text-layer.ts` e `core/parsers/`). `text-layer.ts` contiene le primitive
geometriche: ricostruzione delle righe, fusione dei frammenti in token, e soprattutto
`celleDaIntestazione`, che deduce le colonne di una griglia dalla riga di intestazione. La
regola che tiene insieme tutto è che i valori sono allineati a destra dentro la loro cella,
quindi non si sovrappongono all'etichetta: una cella va dall'inizio della propria etichetta
all'inizio della successiva, e un valore appartiene alla cella che contiene il suo centro.

`parsers/zucchetti.parser.ts` applica queste primitive al modello Zucchetti. Due dettagli
scoperti sul campo che vale la pena conoscere prima di toccare il codice:

Nel corpo piccolo delle intestazioni la distanza fra due lettere della stessa parola e quella
fra due parole sono identiche (circa un punto tipografico), e pdf.js può restituire il testo
lettera per lettera. Ricostruire gli spazi è impossibile, quindi ogni confronto passa da
`chiave()`, che elimina spazi e punteggiatura: `DESCRIZIONE VOCE`, `DESCRIZIONEVOCE` e
`D E S C R I Z I O N E V O C E` diventano la stessa chiave.

L'importo di una voce è sempre il numero più a destra della sua riga. Classificando solo
quello si evita di confondere un'aliquota (9,190) o un imponibile (1.614,00) con un importo,
e le righe di servizio si scartano da sole perché il loro ultimo numero non cade in nessuna
colonna monetaria.

**3. Generazione** (`core/riepilogo-pdf.service.ts`). pdf-lib disegna il riepilogo su due
pagine A4: la sintesi a schede e il dettaglio voce per voce. Il disegno usa coordinate con
origine in alto a sinistra, convertite per pdf-lib in un unico punto (`Tela.testo`,
`Tela.scheda`), perché ragionare "dall'alto verso il basso" evita la maggior parte degli
errori di posizionamento.

## La validazione è la parte importante

Un parser che sbaglia non solleva errori: restituisce numeri plausibili ma falsi, ed è il modo
più facile di prendere una decisione sbagliata su dati veri. Per questo `valida()` in
`zucchetti.parser.ts` verifica tre identità prima che il PDF venga prodotto: che lordo meno
trattenute dia esattamente il netto stampato, che le voci di competenza sommino al totale
competenze, e che le trattenute sommino al totale trattenute.

Quando un controllo non passa, il riepilogo viene comunque generato ma con un riquadro rosso
in prima pagina e l'elenco dei problemi nell'interfaccia. Meglio un avviso vistoso che un
numero sbagliato scritto in grande.

Le trattenute meritano una nota: IRPEF e arrotondamenti non compaiono fra le righe voce, stanno
nei riquadri fiscali in fondo al cedolino. `sintetizzaVociDaiTotali()` li aggiunge all'elenco,
marcati come `sintetica`, altrimenti il dettaglio non quadrerebbe mai col totale.

## Verifica

```bash
npm test                        # tutti i controlli
npm run test:tokenizzazione     # stessi token da parole, caratteri e righe intere
npm run test:segnalazione       # composizione e troncamento dell'email di segnalazione
npm run test:parser             # cedolino Zucchetti, fixture a parole
npm run test:parser:caratteri   # lo stesso, fixture carattere per carattere
npm run test:generico           # parser generico su un altro gestionale
npm run test:generico:caratteri # lo stesso, carattere per carattere
npm run test:layout             # il disegno non produce coordinate assurde
npm run test:layout:generico    # idem, su un cedolino senza ferie né TFR
```

Ogni parser gira su due fixture dello stesso PDF: uno a parole (poppler) e uno carattere per
carattere (pdfplumber, che simula fedelmente pdf.js). È il controllo che mancava.

Girano con il type stripping di Node (serve Node 22.6 o successivo), senza installare nulla e
senza toolchain: il codice è scritto per essere eseguibile così, quindi niente `enum`, niente
parameter property nei costruttori e `import type` per i tipi.

I test lavorano su fixture di token con coordinate estratti da cedolini veri: `fixture.json` per
il modello Zucchetti, `fixture-generico.json` per un secondo gestionale. `generico.test.ts`
verifica anche che i parser non si rubino i documenti a vicenda, che è il tipo di regressione più
insidiosa quando l'elenco cresce. I fixture si rigenerano dai PDF senza passare dal browser, in due granularità:

```bash
# a parole
pdftotext -bbox-layout cedolino.pdf /tmp/cedolino.xml
node test/bbox-fixture.mjs /tmp/cedolino.xml > test/fixture.json

# carattere per carattere (richiede pdfplumber, usato solo qui)
python3 test/chars-fixture.py cedolino.pdf > test/fixture-caratteri.json
```

Attenzione: il fixture incluso è generato dal cedolino di agosto 2026 e contiene dati
personali veri (codice fiscale, IBAN, retribuzione). È già escluso dal versionamento in
`.gitignore`; se pubblichi il progetto, rigeneralo da un cedolino di prova o cancellalo.

`test/layout.test.ts` sostituisce pdf-lib con un finto che registra le operazioni di disegno,
e verifica che nessun elemento abbia coordinate non finite o finisca fuori pagina. Non produce
un PDF: serve a scovare i problemi prima di aprire il browser.

**Cosa è verificato e cosa no.** I parser sono stati provati su due cedolini reali di gestionali
diversi, ciascuno in due granularità di estrazione, e tutti i valori tornano: anagrafica, presenze, voci con ore e aliquote, ratei, totali,
progressivi e le identità di quadratura per il modello Zucchetti; totali, calibrazione delle
colonne, netto ricavato per differenza e confermato, anagrafica e IBAN per il generico. La logica
di layout passa i controlli automatici su entrambi. Quello che **non** è stato eseguito è la resa grafica reale con
pdf-lib e l'estrazione reale con pdf.js, perché richiedono le dipendenze installate: al primo
avvio guarda l'anteprima e, se gli angoli arrotondati risultassero disegnati male, la causa è
`drawSvgPath` e basta passare `raggio: 0` alle chiamate di `Tela.scheda` per tornare a
rettangoli spigolosi.

## Una trappola da conoscere: WinAnsi

I font standard di pdf-lib (Helvetica e compagnia) usano la codifica WinAnsi, che copre
l'alfabeto latino e i simboli tipografici comuni (`€`, `•`, `–`, `’`, `…`) ma non altro. Un
carattere fuori tabella non viene ignorato: fa fallire il salvataggio con
`WinAnsi cannot encode`. È accaduto con una freccia `→` usata per separare agenzia e azienda
utilizzatrice.

Per questo tutto il testo passa da `soloWinAnsi()` prima di essere disegnato: i caratteri noti
vengono sostituiti con un equivalente, gli altri con un punto interrogativo, e in nessun caso
la generazione si interrompe. Serve perché le stringhe arrivano da fonti non controllate — le
ragioni sociali e le descrizioni voce sono scritte da chi ha configurato il gestionale.

Il finto pdf-lib del banco di prova solleva la stessa eccezione della libreria vera, quindi un
carattere non gestito fa fallire `npm run test:layout` invece di comparire nel browser. Se un
giorno servissero altri alfabeti, la strada è incorporare un font TrueType con fontkit e
passare a Unicode.

## La granularità del testo: l'insidia più costosa

pdf.js non restituisce parole: restituisce il testo **con la granularità con cui il PDF lo
disegna**. Alcuni documenti emettono una parola per volta, altri un carattere per volta con un
posizionamento esplicito per ogni lettera (tipico delle stampanti virtuali PostScript), altri
un'intera riga con gli spazi dentro. Lo stesso contenuto, tre input completamente diversi.

Questo ha lasciato passare un difetto fino al browser, e vale la pena capire perché: i fixture
erano generati con `pdftotext`, che ricompone le parole da solo. I test giravano quindi su un
input più comodo di quello reale, e passavano mentre l'app non funzionava. La lezione è che un
fixture deve somigliare alla fonte, non a quello che fa comodo.

Ora il tokenizzatore è indipendente dalla granularità, con due accorgimenti. In `text-layer.ts`
la soglia che separa due parole non è una costante ma una frazione del corpo del carattere
(`gapParola`): lo spazio di un font misura fra un quarto e un terzo del corpo, mentre fra due
lettere della stessa parola la distanza è prossima a zero, e un quinto del corpo cade nel mezzo.
In `pdf-text.service.ts`, `dividiInParole` spezza i frammenti che contengono spazi, perché
altrimenti il bordo destro appartiene solo all'ultimo campo e tutti gli altri perdono la colonna.

`test/tokenizzazione.test.ts` verifica che la stessa riga dia gli stessi token nelle tre
granularità, e che i bordi destri coincidano.

## Glifi senza mappatura Unicode

I moduli dei cedolini disegnano cornici e filetti con font simbolici privi di `ToUnicode`. Questi
glifi finiscono nel flusso di testo insieme ai dati, e non sono un fastidio estetico: nel secondo
cedolino provato il filetto verticale della tabella cade **a metà del codice voce**, che viene
letto come `10?1` invece di `101`. Da lì in poi nessun confronto funziona.

`pulisciTesto` li elimina prima della ricostruzione delle parole, in tre forme: la notazione
`(cid:N)` di alcuni estrattori, i caratteri di controllo che pdf.js produce per i glifi non
mappabili, e l'area Unicode a uso privato. Eliminarli è sufficiente perché i caratteri dei dati
sono contigui e si riuniscono da soli.

In quel documento il 21% dei caratteri è non mappabile, ma sono tutti decorazioni del modulo: i
dati sono in Courier, un font standard. Se invece è il testo a essere illeggibile, il servizio se
ne accorge (meno di cento caratteri alfanumerici in tutta la pagina) e lo dice invece di far
credere a un formato non supportato.

## Quando il parsing fallisce, l'app mostra cosa ha letto

`FormatoNonSupportatoError` porta con sé le prime righe del testo estratto, e l'interfaccia le
mostra con un pulsante per copiarle. Senza vedere *cosa* ha letto il browser non si distingue un
formato nuovo da un problema di codifica o di rotazione, e si finisce a indovinare: questa è la
differenza fra un errore utile e un errore muto.

## Accettare più formati possibile

Aggiungere un parser per ogni gestionale non scala: Zucchetti, Inaz, TeamSystem, Team, Sistemi
e decine di modelli interni hanno layout completamente diversi. Per questo esistono due livelli.

I **parser dedicati** (oggi solo `ZucchettiParser`) conoscono un modello preciso e ne estraggono
tutto: aliquote, imponibili, ratei di ferie e permessi, TFR, progressivi dell'anno. Sono i primi
a essere interrogati.

Il **parser generico** (`GenericoParser`) è la rete di sicurezza, e non conosce nessun modello.
Si appoggia a tre regolarità che valgono per quasi ogni cedolino italiano. La prima è che i
totali sono etichettati a parole, perché il dipendente deve poterli ritrovare: si cercano
`TOTALE COMPETENZE` e `TOTALE RITENUTE` con un confronto **esatto** sulla descrizione della riga,
perché `TOTALE RITENUTE SOCIALI` è un sottototale e prenderlo per il totale generale falserebbe
tutto il resto. La seconda è che gli importi sono allineati a destra in colonne, anche quando le
intestazioni non sono leggibili. La terza è quella che fa funzionare tutto:

> la colonna delle competenze è quella i cui importi sommano al totale competenze.

È il documento stesso a dire quale colonna è quale. Non serve leggere nessuna intestazione, e la
verifica coincide con la calibrazione: se nessun gruppo di importi somma al totale, il parser lo
dichiara invece di indovinare.

Per aggiungere un parser dedicato, implementa `CedolinoParser` (`riconosce` + `analizza`) in
`core/parsers/` e inseriscilo in `parsers` dentro `CedolinoService`, **prima** del generico.

### Tre insidie che il generico deve gestire, e che si incontrano subito

Nel secondo cedolino provato (un modello generato da Word) le intestazioni di colonna non sono
testo: sono glifi di un font simbolico e l'estrazione restituisce `!`, `"`, `#`. È il motivo per
cui la tecnica delle celle dedotte dall'intestazione, che funziona benissimo su Zucchetti, qui
non è applicabile.

Il netto non è etichettato: compare solo accanto all'IBAN sotto la parola `IMPORTO`. Invece di
inseguire tutte le varianti, il parser lo calcola per differenza e poi **verifica che quel numero
esista davvero nel documento**: se c'è, la lettura è confermata da due strade indipendenti.

L'arrotondamento al centesimo sta *fuori* dal totale competenze, pur essendo stampato nella
stessa colonna — mentre su Zucchetti è dentro. La calibrazione prova entrambe le ipotesi, e
`identitaNetto()` in `validazione.ts` accetta tutte le combinazioni plausibili di arrotondamento
invece della sola sottrazione secca.

### Pagine ruotate

Molti cedolini sono stampati in orizzontale, con `/Rotate 90` nel PDF. Le matrici degli item di
pdf.js sono nello spazio della pagina **non** ruotata, quindi vanno composte con quella del
viewport (`pdfjs.Util.transform`): senza questo passaggio righe e colonne risultano scambiate e
il parsing produce risultati casuali. Il viewport porta anche l'origine in alto a sinistra, che è
la convenzione usata in tutto `text-layer.ts`.

## Limiti noti

Funziona solo su PDF con testo selezionabile, cioè gli originali scaricati dal portale paghe.
Su una scansione o una fotografia non c'è testo da estrarre e servirebbe l'OCR (Tesseract), che
introduce errori di lettura proprio sulle cifre: è il motivo per cui è stato lasciato fuori.

La correzione per le pagine ruotate è scritta ma non eseguita con pdf.js, perché richiede il
browser: se su un cedolino orizzontale i dati risultassero mescolati, è il primo punto da
guardare. Il fixture carattere per carattere, che copre lo stesso documento ruotato, passa.

Le settimane INPS non vengono lette: nel modello Zucchetti sono stampate attaccate al codice
CNEL (`5CNEL V213`) e non sono separabili in modo affidabile.
