# Pubblicare l'app e darla agli amici

Tutto quello che serve, nell'ordine. Non c'è nessun server da affittare: l'app è fatta di soli
file statici, quindi la pubblicazione è gratuita e non c'è niente da mantenere nel tempo.

## 1. Prima di cominciare: la tua email (facoltativo)

Apri `src/app/config.ts` e metti il tuo indirizzo fra gli apici:

```ts
export const EMAIL_SEGNALAZIONI = 'tua.email@esempio.it';
```

Serve al pulsante «Segnala questo formato», che compare quando un cedolino non viene riconosciuto
e prepara un'email con il solo testo estratto dal PDF. Se lasci il campo vuoto il pulsante non
appare e resta solo quello che copia il testo negli appunti: l'app funziona comunque.

L'email non allega mai il PDF, ma il testo contiene nome e importi di chi l'ha generata.
Nell'interfaccia è scritto chiaramente, e l'invio parte solo se la persona preme il pulsante.

## 2. Crea il repository su GitHub

Il nome che scegli diventa parte dell'indirizzo del sito, quindi scegline uno leggibile:
`riepilogo-cedolino` dà `https://tuonome.github.io/riepilogo-cedolino/`.

Il repository va creato **pubblico**: con un account gratuito, GitHub Pages pubblica solo da
repository pubblici. Nel repository finisce il codice, mai dati di nessuno.

## 3. Carica i file

Dalla cartella del progetto:

```bash
git init
git add .
git commit -m "Riepilogo busta paga"
git branch -M main
git remote add origin https://github.com/TUONOME/riepilogo-cedolino.git
git push -u origin main
```

Prima di premere invio sull'ultimo comando, un controllo che vale la pena fare:

```bash
git status --short
```

Fra i file elencati **non** devono comparire `test/fixture*.json`. Sono generati da cedolini veri
e contengono codice fiscale, IBAN e retribuzione: `.gitignore` li esclude già, questo è solo per
dormire tranquilla.

## 4. Attiva GitHub Pages

Nel repository: **Settings → Pages**, e sotto *Source* scegli **GitHub Actions**. Non serve altro:
il file `.github/workflows/deploy.yml` è già pronto e fa tutto da sé.

## 5. Guarda la pubblicazione

Vai nella scheda **Actions**: trovi il processo «Pubblica su GitHub Pages» in corso. Esegue i
controlli automatici, compila l'app e la mette online. Due o tre minuti.

Quando il pallino diventa verde, il sito è raggiungibile all'indirizzo che compare in
Settings → Pages. Da quel momento ogni modifica che carichi con `git push` ripubblica il sito da
sola.

## 6. Verifica che sia tutto a posto

Apri l'indirizzo e carica un cedolino. Poi due controlli che richiedono mezzo minuto:

**Da telefono.** Apri lo stesso indirizzo dal cellulare e carica un PDF salvato sul telefono. Su
schermo piccolo l'anteprima incorporata non viene mostrata — Safari su iPhone non visualizza i PDF
dentro una pagina — e al suo posto compaiono i pulsanti «Scarica il PDF» e «Apri il riepilogo».

**Che non venga caricato niente.** Nel browser premi F12, apri la scheda *Network* e carica un
cedolino: dopo i file iniziali del sito non deve comparire nessuna richiesta. È la verifica
diretta di quello che prometti agli amici.

## 7. Il messaggio da mandare agli amici

> Ho messo online una paginetta che trasforma la busta paga in un riepilogo leggibile: lordo,
> trattenute, netto, ferie e TFR su un foglio solo, da scaricare in PDF.
>
> 👉 https://tuonome.github.io/riepilogo-cedolino/
>
> Due cose da sapere. La prima: il file **non viene caricato da nessuna parte**. Non c'è un server,
> il calcolo avviene dentro il tuo browser e la busta paga non esce dal tuo telefono o computer.
> La seconda: serve il PDF originale scaricato dal portale paghe, non la fotografia del cedolino,
> perché da una foto non si può leggere il testo.
>
> Funziona anche dal telefono. Se ti dice che non riconosce il formato non è colpa tua: ogni
> azienda usa un programma diverso. In quel caso c'è un pulsante «Segnala questo formato», così
> posso farlo aggiungere.

## Cose utili da sapere

**Quanto costa.** Niente. GitHub Pages è gratuito e i limiti (un giga di spazio, cento giga di
traffico al mese) sono fuori scala rispetto a una pagina che pesa qualche megabyte.

**Se un amico ti segnala un formato non letto.** Mandami il testo che ti ha inviato: contiene le
prime righe estratte dal PDF, che è esattamente ciò che serve per capire se basta insegnare al
parser generico una nuova etichetta o se serve un parser dedicato.

**Il riepilogo non ha valore fiscale**, ed è scritto in fondo al PDF generato. È uno strumento per
capire la propria busta paga, non un documento da esibire.

**Se vuoi un indirizzo tuo** tipo `cedolino.tuodominio.it`, si imposta in Settings → Pages alla
voce *Custom domain*, aggiungendo un record CNAME presso chi ti gestisce il dominio.
