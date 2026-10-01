import type { Cedolino, VoceImporto } from '../cedolino.model';
import { cedolinoVuoto } from '../cedolino.model';
import type { ColonnaImporti, Line } from '../text-layer';
import {
  chiave,
  codiceRiga,
  colonneImporti,
  descrizioneRiga,
  leggiRigaRatei,
  numeri,
} from '../text-layer';
import type { CedolinoParser } from './cedolino-parser';
import { valida } from '../validazione';

/**
 * Parser indipendente dal gestionale.
 *
 * Non conosce nessun modello in particolare: si appoggia a tre regolarità che
 * valgono per quasi ogni cedolino italiano.
 *
 * 1. I totali sono etichettati a parole ("TOTALE COMPETENZE", "TOTALE RITENUTE"),
 *    perché sono le voci che il dipendente deve poter ritrovare.
 * 2. Gli importi sono allineati a destra in colonne, anche quando le
 *    intestazioni di colonna non sono testo leggibile.
 * 3. La colonna delle competenze è quella i cui importi sommano al totale
 *    competenze; idem per le ritenute. È questa identità che permette di
 *    riconoscere il significato delle colonne senza leggere le intestazioni:
 *    la calibrazione la fa il documento stesso.
 *
 * Produce meno dettagli di un parser dedicato (niente aliquote, ratei parziali),
 * ma quello che produce è verificato dalla quadratura, quindi è affidabile o
 * dichiaratamente sospetto.
 */
export class GenericoParser implements CedolinoParser {
  readonly formato = 'Generico (riconosciuto dai totali)';

  riconosce(righe: Line[]): boolean {
    const totali = trovaTotali(righe);
    return totali.competenze !== undefined && totali.trattenute !== undefined;
  }

  analizza(righe: Line[]): Cedolino {
    const c = cedolinoVuoto(this.formato);

    const totali = trovaTotali(righe);
    c.totali.competenze = totali.competenze ?? 0;
    c.totali.trattenute = totali.trattenute ?? 0;

    const colonne = colonneImporti(righe);
    const righeTotali = new Set(
      [totali.rigaCompetenze, totali.rigaTrattenute].filter((r): r is Line => !!r),
    );

    const colCompetenze = calibra(colonne, c.totali.competenze, righeTotali);
    const colTrattenute = calibra(colonne, c.totali.trattenute, righeTotali);

    if (colCompetenze) {
      c.competenze = vociDaColonna(colCompetenze, righeTotali, 'competenze');
      c.totali.arrotondamentoAttuale = colCompetenze.arrotondamento;
    } else {
      c.anomalie.push(
        'Non ho individuato la colonna delle competenze: nessun gruppo di importi somma al totale.',
      );
    }
    if (colTrattenute) {
      c.trattenute = vociDaColonna(colTrattenute, righeTotali, 'trattenute');
      c.totali.arrotondamentoPrecedente = colTrattenute.arrotondamento;
    } else {
      c.anomalie.push(
        'Non ho individuato la colonna delle trattenute: nessun gruppo di importi somma al totale.',
      );
    }

    c.totali.netto = trovaNetto(righe, c);
    anagrafica(righe, c);
    dettagliNoti(righe, c);
    ratei(righe, c);
    valida(c);

    return c;
  }
}

// ------------------------------------------------------------------- totali

interface Totali {
  competenze?: number;
  trattenute?: number;
  rigaCompetenze?: Line;
  rigaTrattenute?: Line;
}

/** Etichette con cui i gestionali indicano il totale delle competenze. */
const ETICHETTE_COMPETENZE = [
  'TOTALECOMPETENZE',
  'TOTCOMPETENZE',
  'TOTALERETRIBUZIONE',
  'TOTALEELEMENTIRETRIBUTIVI',
  'TOTALELORDO',
  'RETRIBUZIONELORDA',
];

/** Etichette con cui i gestionali indicano il totale delle trattenute. */
const ETICHETTE_TRATTENUTE = [
  'TOTALERITENUTE',
  'TOTTRATTENUTE',
  'TOTALETRATTENUTE',
  'TOTALERITENUTEETRATTENUTE',
  'TOTALEDEDUZIONI',
];

/**
 * Cerca i totali confrontando la descrizione **esatta** della riga con le
 * etichette note. Il confronto esatto è essenziale: "TOTALE RITENUTE SOCIALI" e
 * "TOTALE RITENUTE IRPEF" sono sottototali, e prenderli per il totale generale
 * falserebbe tutto il resto.
 */
function trovaTotali(righe: Line[]): Totali {
  const out: Totali = {};
  for (const riga of righe) {
    const descrizione = chiave(descrizioneRiga(riga));
    if (!descrizione) continue;
    const valori = numeri(riga).filter((n) => n.token !== riga.tokens[0]);
    if (valori.length === 0) continue;
    const importo = valori[valori.length - 1].valore;

    if (out.competenze === undefined && ETICHETTE_COMPETENZE.includes(descrizione)) {
      out.competenze = importo;
      out.rigaCompetenze = riga;
    }
    if (out.trattenute === undefined && ETICHETTE_TRATTENUTE.includes(descrizione)) {
      out.trattenute = importo;
      out.rigaTrattenute = riga;
    }
  }
  return out;
}

// -------------------------------------------------------------- calibrazione

interface ColonnaCalibrata {
  colonna: ColonnaImporti;
  /** somma degli arrotondamenti esclusi per far quadrare il totale */
  arrotondamento?: number;
  /** righe escluse dalla somma: non devono comparire fra le voci */
  escluse: Set<Line>;
}

/**
 * Sceglie la colonna i cui importi sommano al totale indicato.
 *
 * Si tenta due volte: prima con tutti gli importi, poi escludendo le righe di
 * arrotondamento. In alcuni modelli l'arrotondamento è dentro il totale, in
 * altri è fuori pur stando nella stessa colonna, e l'unico modo di saperlo è
 * provare. A parità di esito vince la colonna con più righe, che è quella del
 * dettaglio e non un riepilogo parziale.
 */
function calibra(
  colonne: ColonnaImporti[],
  totale: number,
  righeTotali: Set<Line>,
): ColonnaCalibrata | undefined {
  if (!totale) return undefined;
  const tolleranza = 0.02;
  const candidate: ColonnaCalibrata[] = [];

  for (const colonna of colonne) {
    const valori = colonna.valori.filter((v) => !righeTotali.has(v.riga));
    if (valori.length === 0) continue;

    const somma = valori.reduce((a, b) => a + b.valore, 0);
    if (Math.abs(somma - totale) <= tolleranza) {
      candidate.push({ colonna, escluse: new Set() });
      continue;
    }
    const arrotondamenti = valori.filter((v) => isArrotondamento(v.riga));
    if (arrotondamenti.length > 0) {
      const scarto = arrotondamenti.reduce((a, b) => a + b.valore, 0);
      if (Math.abs(somma - scarto - totale) <= tolleranza) {
        candidate.push({
          colonna,
          arrotondamento: scarto,
          escluse: new Set(arrotondamenti.map((a) => a.riga)),
        });
      }
    }
  }

  candidate.sort((a, b) => b.colonna.valori.length - a.colonna.valori.length);
  return candidate[0];
}

function isArrotondamento(riga: Line): boolean {
  return chiave(descrizioneRiga(riga)).includes('ARROTONDAM');
}

function vociDaColonna(
  calibrata: ColonnaCalibrata,
  righeTotali: Set<Line>,
  colonna: 'competenze' | 'trattenute',
): VoceImporto[] {
  const out: VoceImporto[] = [];
  for (const v of calibrata.colonna.valori) {
    if (righeTotali.has(v.riga)) continue;
    // Se l'arrotondamento è stato escluso per far quadrare il totale, non può
    // comparire fra le voci: la somma del dettaglio non tornerebbe più.
    if (calibrata.escluse.has(v.riga)) continue;
    const descrizione = descrizioneRiga(v.riga);
    if (!descrizione) continue;
    out.push({
      codice: codiceRiga(v.riga),
      descrizione: titoloVoce(descrizione),
      importo: v.valore,
      colonna,
    });
  }
  return out;
}

// --------------------------------------------------------------------- netto

/**
 * Il netto non è sempre etichettato: in alcuni modelli compare solo accanto
 * all'IBAN, sotto la parola "IMPORTO". Invece di inseguire tutte le varianti,
 * lo si calcola per differenza e si controlla che quel numero esista davvero
 * nel documento: se c'è, la lettura è confermata da due strade indipendenti.
 */
function trovaNetto(righe: Line[], c: Cedolino): number {
  const etichette = ['NETTO', 'NETTOINBUSTA', 'NETTODELMESE', 'NETTOAPAGARE', 'NETTOPAGATO', 'IMPORTONETTO'];
  for (const riga of righe) {
    const descrizione = chiave(descrizioneRiga(riga));
    if (!etichette.includes(descrizione)) continue;
    const valori = numeri(riga);
    if (valori.length > 0) return valori[valori.length - 1].valore;
    // etichetta su una riga e valore su quella sotto
    const seguente = righe[righe.indexOf(riga) + 1];
    const sotto = seguente ? numeri(seguente) : [];
    if (sotto.length > 0) return sotto[sotto.length - 1].valore;
  }

  const base = c.totali.competenze - c.totali.trattenute;
  const arrotMese = c.totali.arrotondamentoAttuale ?? 0;
  const arrotPrec = c.totali.arrotondamentoPrecedente ?? 0;
  const ipotesi = [
    base + arrotMese,
    base,
    base + arrotMese - arrotPrec,
    base - arrotPrec,
  ];

  const presenti = new Set<string>();
  for (const riga of righe) {
    for (const { valore } of numeri(riga)) presenti.add(valore.toFixed(2));
  }
  for (const ipotesto of ipotesi) {
    if (presenti.has(ipotesto.toFixed(2))) return Number(ipotesto.toFixed(2));
  }

  c.anomalie.push(
    'Il netto non è etichettato e non trovo nel cedolino un importo che corrisponda ' +
      'alla differenza fra competenze e trattenute: verificalo a mano.',
  );
  return Number((base + arrotMese).toFixed(2));
}

// ---------------------------------------------------------------- anagrafica

const REGEX_CF = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/;
/** IBAN italiano: IT + 2 cifre di controllo + CIN + ABI + CAB + conto = 27 caratteri. */
const REGEX_IBAN = /^IT\d{2}[A-Z0-9]{23}$/;
const MESI = [
  'GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO',
  'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE',
];

function anagrafica(righe: Line[], c: Cedolino): void {
  // Codice fiscale
  let indiceCf = -1;
  for (let i = 0; i < righe.length; i++) {
    const trovato = REGEX_CF.exec(righe[i].text.toUpperCase());
    if (trovato) {
      c.dipendente.codiceFiscale = trovato[0];
      indiceCf = i;
      break;
    }
  }

  // Nome: il gruppo di parole tutte alfabetiche più vicino al codice fiscale.
  // Si guarda prima la riga del codice, poi quelle immediatamente sopra: in
  // molti modelli nome e codice fiscale sono incolonnati uno sotto l'altro.
  if (indiceCf >= 0) {
    for (const indice of [indiceCf, indiceCf - 1, indiceCf - 2, indiceCf + 1]) {
      const riga = righe[indice];
      if (!riga) continue;
      const nome = gruppoNome(riga, c.dipendente.codiceFiscale);
      if (nome) {
        c.dipendente.nome = titoloNome(nome);
        break;
      }
    }
  }

  // Periodo: nome del mese, e anno preso dalla data che cade in quel mese
  for (const riga of righe.slice(0, 12)) {
    const mese = riga.tokens.map((t) => t.text.toUpperCase()).find((t) => MESI.includes(t));
    if (!mese) continue;
    const numeroMese = MESI.indexOf(mese) + 1;
    c.periodo.mese = numeroMese;
    c.periodo.anno = annoDelMese(righe, numeroMese);
    c.periodo.label = c.periodo.anno
      ? `${titoloNome(mese)} ${c.periodo.anno}`
      : titoloNome(mese);
    break;
  }
  if (!c.periodo.label) c.periodo.label = 'Periodo non riconosciuto';

  // IBAN: spesso è spezzato in gruppi ("IT85 K 03069 05058 100000008681"),
  // quindi si accumulano i token alfanumerici contigui e si azzera l'accumulo
  // al primo token che non lo è (un importo, per esempio).
  for (const riga of righe) {
    let accumulo = '';
    for (const token of riga.tokens) {
      const testo = token.text.toUpperCase();
      accumulo = /^[A-Z0-9]+$/.test(testo) ? accumulo + testo : '';
      if (REGEX_IBAN.test(accumulo)) {
        c.iban = accumulo;
        break;
      }
    }
    if (c.iban) break;
  }
}

/** Il gruppo contiguo di parole alfabetiche più lungo della riga. */
function gruppoNome(riga: Line, codiceFiscale: string): string | undefined {
  const gruppi: string[][] = [];
  let corrente: string[] = [];
  let precedente: number | undefined;

  for (const token of riga.tokens) {
    const testo = token.text.toUpperCase();
    const alfabetico =
      /^[A-ZÀ-Ü']{2,}$/.test(testo) && testo !== codiceFiscale && !MESI.includes(testo);
    if (alfabetico && (precedente === undefined || token.x - precedente < 20)) {
      corrente.push(token.text);
    } else {
      if (corrente.length > 0) gruppi.push(corrente);
      corrente = alfabetico ? [token.text] : [];
    }
    precedente = token.x2;
  }
  if (corrente.length > 0) gruppi.push(corrente);

  gruppi.sort((a, b) => b.length - a.length);
  const migliore = gruppi[0];
  return migliore && migliore.length >= 2 ? migliore.join(' ') : undefined;
}

/** Anno della prima data il cui mese coincide con quello di retribuzione. */
function annoDelMese(righe: Line[], mese: number): number | undefined {
  const date: { mese: number; anno: number }[] = [];
  for (const riga of righe) {
    for (const token of riga.tokens) {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(token.text);
      if (m) date.push({ mese: Number(m[2]), anno: Number(m[3]) });
    }
  }
  return date.find((d) => d.mese === mese)?.anno ?? date[0]?.anno;
}

// ------------------------------------------------------------ dettagli noti

/**
 * Informazioni utili riconosciute dalla descrizione, non dalla posizione.
 * Se il cedolino non le contiene, il riepilogo le omette senza errori.
 */
function dettagliNoti(righe: Line[], c: Cedolino): void {
  for (const riga of righe) {
    const descrizione = chiave(descrizioneRiga(riga));
    const valori = numeri(riga).filter((n) => n.token !== riga.tokens[0]);
    if (valori.length === 0) continue;
    const importo = valori[valori.length - 1].valore;

    if (!c.tfrMese && descrizione.includes('TFR') && !descrizione.includes('RESIDUO')) {
      c.tfrMese = importo;
    }
    if (c.presenze.giorniRetribuiti === undefined && descrizione.includes('GIORNIRETRIBUIT')) {
      c.presenze.giorniRetribuiti = importo;
    }
    if (c.presenze.oreLavorate === undefined && descrizione.includes('ORELAVORATE')) {
      c.presenze.oreLavorate = importo;
    }
    if (c.totali.imponibileFiscale === undefined && descrizione.includes('IMPONIBILEIRPEF')) {
      c.totali.imponibileFiscale = importo;
    }
    if (c.totali.irpefLorda === undefined && descrizione.includes('IRPEFLORDA')) {
      c.totali.irpefLorda = importo;
    }
    if (c.totali.irpefNetta === undefined && descrizione.includes('IRPEFNETTA')) {
      c.totali.irpefNetta = importo;
    }
    if (c.totali.detrazioni === undefined && descrizione.includes('TOTALEDETRAZIONI')) {
      c.totali.detrazioni = importo;
    }
  }
}

/** Ratei di ferie e permessi, quando il modello li espone con le parole solite. */
function ratei(righe: Line[], c: Cedolino): void {
  const chiavi = ['Res.AP', 'Matur.', 'Maturato', 'Goduto', 'Godute', 'Saldo', 'Residue', 'Residuo'];
  for (const riga of righe) {
    const k = chiave(riga.text);
    if (!k.startsWith('FERIE')) continue;
    const valori = leggiRigaRatei(riga, chiavi);
    if (valori.size === 0) continue;
    const maturato = valori.get('Matur.') ?? valori.get('Maturato') ?? 0;
    const goduto = valori.get('Goduto') ?? valori.get('Godute') ?? 0;
    const saldo =
      valori.get('Saldo') ?? valori.get('Residue') ?? valori.get('Residuo') ?? maturato - goduto;
    c.ratei.ferie = {
      residuoAnnoPrec: valori.get('Res.AP') ?? 0,
      maturato,
      goduto,
      saldo,
    };
    return;
  }
}

// ------------------------------------------------------------------ utilità

/**
 * Sigle di uso corrente nei cedolini, da tenere in maiuscolo.
 * Tutto il resto viene minuscolizzato: "MINIMO TABELLARE" diventa
 * "Minimo tabellare", non "Minimo Tabellare".
 */
const SIGLE = new Set([
  'IRPEF', 'INPS', 'INAIL', 'IVS', 'FPLD', 'TFR', 'CCNL', 'IBAN', 'ROL', 'EDR',
  'FAP', 'FSBS', 'PDR', 'ACC', 'INPGI', 'ENPALS', 'CIGO', 'CIGS', 'NASPI', 'ANF',
]);

/**
 * Riconosce le sigle senza elencarle tutte: oltre a quelle note, restano
 * maiuscole le parole che contengono cifre o punti (F.A.P., L.207/2024) e quelle
 * brevi senza vocali (TFR, PDR). Una parola breve *con* vocali è quasi sempre
 * una parola vera - "AD", "DI", "MESE" - e va minuscolizzata.
 */
function sigla(parola: string): boolean {
  const pulita = parola.replace(/[^A-Z0-9.\/]/g, '');
  if (SIGLE.has(pulita)) return true;
  if (/[0-9]/.test(pulita) || pulita.includes('.') || pulita.includes('/')) return true;
  return pulita.length <= 4 && pulita.length > 0 && !/[AEIOU]/.test(pulita);
}

/** "MINIMO TABELLARE" diventa "Minimo tabellare"; le sigle restano intatte. */
function titoloVoce(testo: string): string {
  const parole = testo.split(/\s+/).filter((p) => p.length > 0);
  return parole
    .map((parola, indice) => {
      if (sigla(parola.toUpperCase()) && parola === parola.toUpperCase()) return parola;
      const minuscola = parola.toLowerCase();
      return indice === 0 ? minuscola.charAt(0).toUpperCase() + minuscola.slice(1) : minuscola;
    })
    .join(' ');
}

/** "PASINI LUCA" diventa "Pasini Luca": per nomi e mesi ogni parola va maiuscola. */
function titoloNome(testo: string): string {
  return testo
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
