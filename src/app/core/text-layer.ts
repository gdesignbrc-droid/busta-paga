/**
 * Primitive geometriche per leggere un PDF a layout fisso.
 *
 * Un cedolino non è un documento strutturato: è una griglia di etichette e
 * numeri posizionati a coordinate assolute. Per questo il parsing non lavora
 * su testo piatto ma su token con coordinate, e ricostruisce righe e celle.
 *
 * Convenzione: y cresce verso il BASSO (distanza dal bordo superiore),
 * come nei viewport di pdf.js.
 *
 * Nota sul confronto delle etichette: nel corpo piccolo usato per le
 * intestazioni, la distanza fra due lettere della stessa parola e quella fra
 * due parole sono indistinguibili (~1 punto), e pdf.js può restituire il testo
 * lettera per lettera. Per questo ogni confronto passa da chiave(), che ignora
 * spazi e punteggiatura: "DESCRIZIONE VOCE", "DESCRIZIONEVOCE" e
 * "D E S C R I Z I O N E V O C E" diventano la stessa chiave.
 */

export interface TextItem {
  text: string;
  /** bordo sinistro */
  x: number;
  /** bordo destro */
  x2: number;
  /** distanza dal bordo superiore della pagina */
  y: number;
  /** corpo del carattere in punti, quando disponibile */
  corpo?: number;
}

export interface Token extends TextItem {}

export interface Line {
  y: number;
  tokens: Token[];
  /** testo della riga, con i token separati da spazio singolo */
  text: string;
}

/** Tolleranza verticale per considerare due token sulla stessa riga. */
const TOLLERANZA_RIGA = 2.5;
/** Distanza orizzontale massima per fondere token nella stessa etichetta. */
const GAP_ETICHETTA = 6.5;

/**
 * Corpo presunto quando l'estrattore non lo fornisce.
 * Corrisponde al corpo tipico del testo di un cedolino.
 */
const CORPO_PREDEFINITO = 9.5;

/**
 * Distanza oltre la quale due frammenti sono parole distinte.
 *
 * Non può essere una costante: dipende da quanto è grande il testo. La regola
 * tipografica è che lo spazio di un font proporzionale misura fra un quarto e un
 * terzo del corpo, mentre fra due lettere della stessa parola la distanza è
 * prossima a zero (a volte negativa, per via della crenatura). Un quinto del
 * corpo cade quindi nel mezzo delle due popolazioni.
 *
 * Questo rende la ricostruzione delle parole indipendente da come il PDF è stato
 * scritto: alcuni documenti disegnano una parola per volta, altri un carattere
 * per volta con posizionamento esplicito, e pdf.js riporta fedelmente entrambi.
 */
function gapParola(corpo: number | undefined): number {
  const dimensione = corpo && corpo > 0 ? corpo : CORPO_PREDEFINITO;
  return Math.min(3.5, Math.max(1, dimensione * 0.2));
}

/**
 * Chiave di confronto: solo lettere, cifre e barra, in maiuscolo.
 * Rende i confronti immuni alla frammentazione del testo.
 */
export function chiave(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

/**
 * Rimuove i caratteri che non rappresentano testo.
 *
 * I moduli dei cedolini disegnano cornici e filetti con font simbolici privi di
 * mappatura Unicode, e questi glifi finiscono nel flusso di testo insieme ai
 * dati. Non sono un fastidio estetico: capita che cadano *dentro* un numero (il
 * codice voce 101 diventa `10?1`) perché il filetto verticale della tabella si
 * trova a metà della cifra. Vanno eliminati prima di ricostruire le parole.
 *
 * Le forme note sono tre: la notazione `(cid:N)` usata da alcuni estrattori, i
 * caratteri di controllo che pdf.js restituisce quando il glifo non è mappabile,
 * e l'area Unicode a uso privato.
 */
export function pulisciTesto(testo: string): string {
  return testo
    .replace(/\(cid:\d+\)/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\uE000-\uF8FF\uFFFD]/g, '');
}

/** Raggruppa gli item in righe e fonde i frammenti contigui in token. */
export function costruisciRighe(items: TextItem[]): Line[] {
  const ordinati = items
    .map((i) => ({ ...i, text: pulisciTesto(i.text) }))
    .filter((i) => i.text.trim() !== '')
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const righe: Line[] = [];
  for (const item of ordinati) {
    const ultima = righe[righe.length - 1];
    if (ultima && Math.abs(ultima.y - item.y) <= TOLLERANZA_RIGA) {
      ultima.tokens.push({ ...item });
    } else {
      righe.push({ y: item.y, tokens: [{ ...item }], text: '' });
    }
  }

  for (const riga of righe) {
    riga.tokens.sort((a, b) => a.x - b.x);
    riga.tokens = fondiInParole(riga.tokens);
    riga.y = Math.min(...riga.tokens.map((t) => t.y));
    riga.text = riga.tokens.map((t) => t.text).join(' ');
  }
  return righe;
}

/**
 * Fonde i frammenti contigui in parole, con la soglia calcolata sul corpo del
 * frammento più grande fra i due: fra un'etichetta piccola e un numero grande
 * vince la distanza più permissiva, che è quella giusta per non spezzare il numero.
 */
function fondiInParole(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    const prec = out[out.length - 1];
    const soglia = gapParola(Math.max(prec?.corpo ?? 0, t.corpo ?? 0) || undefined);
    if (prec && t.x - prec.x2 < soglia) {
      prec.text += t.text;
      prec.x2 = Math.max(prec.x2, t.x2);
      prec.corpo = Math.max(prec.corpo ?? 0, t.corpo ?? 0) || undefined;
    } else {
      out.push({ ...t });
    }
  }
  return out;
}

/** Fonde i token la cui distanza orizzontale è inferiore alla soglia. */
function fondi(tokens: Token[], soglia: number, colla: string): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    const prec = out[out.length - 1];
    if (prec && t.x - prec.x2 < soglia) {
      prec.text += colla + t.text;
      prec.x2 = Math.max(prec.x2, t.x2);
    } else {
      out.push({ ...t });
    }
  }
  return out;
}

/** Raggruppa i token di una riga in etichette (es. "TOT COMPETENZE"). */
export function gruppiEtichetta(riga: Line): Token[] {
  return fondi(riga.tokens, GAP_ETICHETTA, ' ');
}

export interface Cella {
  /** etichetta normalizzata con chiave() */
  etichetta: string;
  /** testo originale dell'intestazione */
  testo: string;
  /** bordo sinistro della cella */
  da: number;
  /** bordo sinistro della cella successiva */
  a: number;
}

/**
 * Costruisce le celle di una griglia a partire dalla riga di intestazione.
 * I valori sono allineati a destra dentro la propria cella, quindi non si
 * sovrappongono all'etichetta: l'unica regola affidabile è "la cella va
 * dall'inizio della sua etichetta all'inizio della successiva".
 */
export function celleDaIntestazione(riga: Line): Cella[] {
  const gruppi = gruppiEtichetta(riga);
  return gruppi.map((g, i) => ({
    etichetta: chiave(g.text),
    testo: g.text,
    da: i === 0 ? Number.NEGATIVE_INFINITY : g.x,
    a: i + 1 < gruppi.length ? gruppi[i + 1].x : Number.POSITIVE_INFINITY,
  }));
}

/** Etichetta della cella che contiene il centro del token, se esiste. */
export function cellaDi(celle: Cella[], token: Token): string | undefined {
  const centro = (token.x + token.x2) / 2;
  return celle.find((c) => centro >= c.da && centro < c.a)?.etichetta;
}

/** Tutti i token, raggruppati per cella della griglia. */
export function leggiGrigliaToken(intestazione: Line, valori: Line): Map<string, Token[]> {
  const celle = celleDaIntestazione(intestazione);
  const out = new Map<string, Token[]>();
  for (const token of valori.tokens) {
    const etichetta = cellaDi(celle, token);
    if (!etichetta) continue;
    const elenco = out.get(etichetta) ?? [];
    elenco.push(token);
    out.set(etichetta, elenco);
  }
  return out;
}

/** Contenuto testuale di ogni cella della griglia. */
export function leggiGrigliaTesto(intestazione: Line, valori: Line): Map<string, string> {
  const out = new Map<string, string>();
  for (const [etichetta, token] of leggiGrigliaToken(intestazione, valori)) {
    out.set(etichetta, token.map((t) => t.text).join(' ').trim());
  }
  return out;
}

/**
 * Legge una griglia etichetta/valore: intestazioni su una riga, valori sulla
 * riga immediatamente sotto.
 *
 * Alcuni modelli spezzano un valore in parte intera e decimali ("136" "00" per
 * 136,00 ore): se una cella contiene due numeri e il secondo è di due cifre,
 * vengono ricomposti.
 */
export function leggiGriglia(intestazione: Line, valori: Line): Map<string, number> {
  const out = new Map<string, number>();
  for (const [etichetta, token] of leggiGrigliaToken(intestazione, valori)) {
    const numerici = token
      .map((t) => ({ testo: t.text, valore: aNumero(t.text) }))
      .filter((v): v is { testo: string; valore: number } => v.valore !== null);
    if (numerici.length === 0) continue;
    if (numerici.length === 2 && /^\d{2}$/.test(numerici[1].testo)) {
      const segno = numerici[0].valore < 0 ? -1 : 1;
      out.set(etichetta, numerici[0].valore + (segno * numerici[1].valore) / 100);
    } else {
      out.set(etichetta, numerici[numerici.length - 1].valore);
    }
  }
  return out;
}

/**
 * Converte un numero in formato italiano ("1.234,56", "-16,000", "****1377,00")
 * nel corrispondente valore numerico. Restituisce null se non è un numero.
 */
export function aNumero(testo: string): number | null {
  const pulito = testo.replace(/\*/g, '').replace(/\s/g, '').trim();
  if (!/^[+-]?\d{1,3}(\.\d{3})*(,\d+)?$/.test(pulito) && !/^[+-]?\d+(,\d+)?$/.test(pulito)) {
    return null;
  }
  const valore = Number(pulito.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(valore) ? valore : null;
}

/** Tutti i token numerici di una riga, da sinistra a destra. */
export function numeri(riga: Line): { token: Token; valore: number }[] {
  const out: { token: Token; valore: number }[] = [];
  for (const token of riga.tokens) {
    const valore = aNumero(token.text);
    if (valore !== null) out.push({ token, valore });
  }
  return out;
}

/** Primo token della riga, se somiglia a un codice voce. */
export function codiceRiga(riga: Line): string | undefined {
  const primo = riga.tokens[0];
  if (!primo) return undefined;
  return /^[A-Z0-9][A-Z0-9./-]{0,7}$/.test(primo.text) ? primo.text : undefined;
}

/** Descrizione della riga: i token non numerici, escluso il codice iniziale. */
export function descrizioneRiga(riga: Line): string {
  const codice = codiceRiga(riga);
  return riga.tokens
    .filter((t, i) => !(i === 0 && t.text === codice))
    .filter((t) => aNumero(t.text) === null)
    .map((t) => t.text)
    .join(' ')
    .replace(/^[*\s]+/, '')
    .trim();
}

export interface ColonnaImporti {
  /** bordo destro comune ai valori della colonna */
  x2: number;
  valori: { riga: Line; token: Token; valore: number }[];
}

/**
 * Deduce le colonne di importi raggruppando i bordi destri dei numeri.
 *
 * Serve quando le intestazioni non sono utilizzabili: in diversi modelli i
 * titoli delle colonne sono disegnati con font simbolici e l'estrazione
 * restituisce glifi senza senso. Gli importi però restano allineati a destra,
 * e questo allineamento è un'ancora più solida di qualunque etichetta.
 */
export function colonneImporti(righe: Line[], tolleranza = 3): ColonnaImporti[] {
  const colonne: ColonnaImporti[] = [];
  for (const riga of righe) {
    for (const { token, valore } of numeri(riga)) {
      const esistente = colonne.find((c) => Math.abs(c.x2 - token.x2) <= tolleranza);
      if (esistente) {
        esistente.valori.push({ riga, token, valore });
      } else {
        colonne.push({ x2: token.x2, valori: [{ riga, token, valore }] });
      }
    }
  }
  return colonne.sort((a, b) => a.x2 - b.x2);
}

/** Prima riga che contiene tutti i frammenti indicati (confronto via chiave). */
export function rigaCon(righe: Line[], ...frammenti: string[]): Line | undefined {
  const cercati = frammenti.map((f) => chiave(f));
  return righe.find((r) => {
    const t = chiave(r.text);
    return cercati.every((c) => t.includes(c));
  });
}

/** Riga immediatamente successiva a quella indicata. */
export function rigaSeguente(righe: Line[], riga: Line): Line | undefined {
  const i = righe.indexOf(riga);
  return i >= 0 ? righe[i + 1] : undefined;
}

/**
 * Valori di una riga di ratei del tipo:
 *   FERIE : Res.AP   Matur. 16,000  Goduto 32,000  Saldo -16,000
 * Ogni numero appartiene alla parola chiave che lo precede.
 */
export function leggiRigaRatei(riga: Line, chiavi: string[]): Map<string, number> {
  const posizioni: { chiave: string; x: number }[] = [];
  for (const token of riga.tokens) {
    const k = chiave(token.text);
    const trovata = chiavi.find((c) => chiave(c) === k);
    if (trovata) posizioni.push({ chiave: trovata, x: token.x2 });
  }
  posizioni.sort((a, b) => a.x - b.x);

  const valori = numeri(riga);
  const out = new Map<string, number>();
  for (let i = 0; i < posizioni.length; i++) {
    const inizio = posizioni[i].x;
    const fine = i + 1 < posizioni.length ? posizioni[i + 1].x : Number.POSITIVE_INFINITY;
    const valore = valori.find((v) => v.token.x >= inizio && v.token.x < fine);
    if (valore) out.set(posizioni[i].chiave, valore.valore);
  }
  return out;
}
