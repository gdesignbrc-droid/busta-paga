import type { Cedolino, Rateo, VoceImporto } from '../cedolino.model';
import { cedolinoVuoto } from '../cedolino.model';
import type { Cella, Line, Token } from '../text-layer';
import {
  aNumero,
  cellaDi,
  celleDaIntestazione,
  chiave,
  leggiGriglia,
  leggiGrigliaTesto,
  leggiRigaRatei,
  numeri,
  rigaCon,
  rigaSeguente,
} from '../text-layer';
import type { CedolinoParser } from './cedolino-parser';
import { valida } from '../validazione';

const MESI = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

const REGEX_CF = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/;
const REGEX_IBAN = /\bIT\d{2}[A-Z0-9]{19,27}\b/;
const REGEX_CODICE_VOCE = /^[A-Z0-9][A-Z0-9./-]{1,7}$/;

/**
 * Chiavi delle colonne dell'elenco voci. Sono le intestazioni del modello
 * passate da chiave(): senza spazi né punteggiatura.
 */
const COL_CODICE = 'CODICE';
const COL_ORE = 'ORE/GIORNI';
const COL_UNITARIO = 'IMPORTOUNITARIO';
const COL_FIGURATI = 'IMPORTIFIGURATI';
const COL_COMPETENZE = 'COMPETENZE';
const COL_TRATTENUTE = 'TRATTENUTE';

export class ZucchettiParser implements CedolinoParser {
  readonly formato = 'Zucchetti (paghe)';

  riconosce(righe: Line[]): boolean {
    const testo = righe.map((r) => chiave(r.text)).join('|');
    return ['ELEMENTIDELLARETRIBUZIONE', 'TOTCOMPETENZE', 'DESCRIZIONEVOCE'].every((i) =>
      testo.includes(i),
    );
  }

  analizza(righe: Line[]): Cedolino {
    const c = cedolinoVuoto(this.formato);
    this.anagrafica(righe, c);
    this.periodo(righe, c);
    this.presenze(righe, c);
    this.pagaOraria(righe, c);
    this.voci(righe, c);
    this.ratei(righe, c);
    this.totali(righe, c);
    this.sintetizzaVociDaiTotali(c);
    valida(c);
    return c;
  }

  // --------------------------------------------------------------- anagrafica

  private anagrafica(righe: Line[], c: Cedolino): void {
    const rigaCf = righe.find((r) => REGEX_CF.test(r.text.toUpperCase()));
    if (rigaCf) {
      const trovato = REGEX_CF.exec(rigaCf.text.toUpperCase());
      c.dipendente.codiceFiscale = trovato ? trovato[0] : '';

      // Il codice dipendente è attaccato al cognome: "1944089CHICCA BENEDETTA"
      const nomi: string[] = [];
      for (const token of rigaCf.tokens) {
        if (token.text.toUpperCase() === c.dipendente.codiceFiscale) break;
        const cifre = /^\d+/.exec(token.text);
        if (cifre && !c.dipendente.matricola) c.dipendente.matricola = cifre[0];
        const pulito = token.text.replace(/^\d+/, '').trim();
        if (/[A-Za-z]/.test(pulito)) nomi.push(pulito);
      }
      c.dipendente.nome = titolo(nomi.join(' '));
    }

    const intMatricola = rigaCon(righe, 'MATRICOLA', 'DATA ASSUNZIONE');
    const valMatricola = intMatricola ? rigaSeguente(righe, intMatricola) : undefined;
    if (intMatricola && valMatricola) {
      const g = leggiGrigliaTesto(intMatricola, valMatricola);
      c.dipendente.dataNascita = g.get('DATANASCITA');
      c.dipendente.dataAssunzione = g.get('DATAASSUNZIONE');
      c.dipendente.dataCessazione = g.get('DATACESSAZIONE');
      c.dipendente.qualifica = g.get('DESCRIZIONEQUALIFICA');
      c.dipendente.livello = g.get('QUA/IN');
    }

    const rigaAzienda = righe
      .slice(0, 20)
      .find((r) => /(S\.?P\.?A\.?|S\.R\.L\.|S\.A\.S\.|S\.N\.C\.)\s*$/i.test(r.text.trim()));
    if (rigaAzienda) {
      // Sulla stessa riga può trovarsi il codice azienda: va scartato
      c.azienda.nome = rigaAzienda.tokens
        .map((t) => t.text)
        .filter((t) => aNumero(t) === null)
        .join(' ')
        .trim();
    }

    const rigaUtil = rigaCon(righe, 'azienda utilizzatrice');
    if (rigaUtil) {
      const m = /utilizzatrice\s+(.+)$/i.exec(rigaUtil.text);
      if (m) c.azienda.utilizzatrice = m[1].trim();
    }

    for (const riga of righe) {
      const token = riga.tokens.find((t) => REGEX_IBAN.test(t.text.toUpperCase()));
      if (token) {
        c.iban = token.text.toUpperCase();
        break;
      }
    }
  }

  private periodo(righe: Line[], c: Cedolino): void {
    const regex = new RegExp(`\\b(${MESI.join('|')})\\b\\s+(\\d{4})`, 'i');
    for (const riga of righe.slice(0, 25)) {
      const m = regex.exec(riga.text);
      if (!m) continue;
      c.periodo.mese = MESI.indexOf(m[1].toLowerCase()) + 1;
      c.periodo.anno = Number(m[2]);
      c.periodo.label = `${titolo(m[1])} ${m[2]}`;
      return;
    }
  }

  private presenze(righe: Line[], c: Cedolino): void {
    const int = rigaCon(righe, 'ORE LAV.', 'GG. RETR.');
    const val = int ? rigaSeguente(righe, int) : undefined;
    if (!int || !val) return;
    const g = leggiGriglia(int, val);
    c.presenze = {
      oreLavorate: g.get('ORELAV'),
      giorniLavorati: g.get('GGLAV'),
      oreRetribuite: g.get('ORERETR'),
      giorniRetribuiti: g.get('GGRETR'),
      oreStraordinario: g.get('ORESTRAORD'),
      giorniInps: g.get('GGINPS'),
      settimaneInps: g.get('SETINPS'),
    };
  }

  private pagaOraria(righe: Line[], c: Cedolino): void {
    const int = righe.find((r) => chiave(r.text) === 'TOTALE');
    const val = int ? rigaSeguente(righe, int) : undefined;
    if (int && val) {
      const totale = leggiGriglia(int, val).get('TOTALE');
      if (totale !== undefined) {
        c.pagaOraria = totale;
        return;
      }
    }
    // Ripiego: somma degli elementi della retribuzione
    const somma = [rigaCon(righe, 'Retribuzione base'), rigaCon(righe, 'Terzo elemento')]
      .filter((r): r is Line => !!r)
      .flatMap((r) => numeri(r).map((n) => n.valore))
      .reduce((a, b) => a + b, 0);
    if (somma > 0) c.pagaOraria = Number(somma.toFixed(5));
  }

  // -------------------------------------------------------------------- voci

  private voci(righe: Line[], c: Cedolino): void {
    const intestazione = rigaCon(righe, 'DESCRIZIONE VOCE', 'ORE/GIORNI');
    if (!intestazione) {
      c.anomalie.push('Intestazione dell’elenco voci non trovata.');
      return;
    }
    const celle = celleDaIntestazione(intestazione);
    const inizio = righe.indexOf(intestazione) + 1;
    const indiceRatei = righe.findIndex((r, i) => i > inizio && chiave(r.text).startsWith('RATEI'));
    const fine = indiceRatei === -1 ? righe.length : indiceRatei;

    for (let i = inizio; i < fine; i++) {
      const riga = righe[i];
      if (/^-+$/.test(riga.text.replace(/\s/g, ''))) continue;

      const valori = numeri(riga);
      if (valori.length === 0) continue;

      // L'importo della voce è sempre il numero più a destra della riga.
      const ultimo = valori[valori.length - 1];
      const colonna = cellaDi(celle, ultimo.token);
      if (colonna !== COL_COMPETENZE && colonna !== COL_TRATTENUTE && colonna !== COL_FIGURATI) {
        continue; // riga di servizio: imponibili, aliquote, note
      }

      const voce = costruisciVoce(riga, celle, valori, ultimo, colonna);
      if (colonna === COL_COMPETENZE) {
        voce.colonna = 'competenze';
        c.competenze.push(voce);
      } else if (colonna === COL_TRATTENUTE) {
        voce.colonna = 'trattenute';
        c.trattenute.push(voce);
      } else {
        voce.colonna = 'figurati';
        c.figurativi.push(voce);
        if (/TFR/i.test(voce.descrizione)) c.tfrMese = voce.importo;
      }
    }
  }

  // ------------------------------------------------------------------- ratei

  private ratei(righe: Line[], c: Cedolino): void {
    const chiavi = ['Res.AP', 'Matur.', 'Goduto', 'Saldo'];
    const mappa: { test: RegExp; campo: 'ferie' | 'rol' | 'exFestivita' | 'bancaOre' }[] = [
      { test: /^FERIE/, campo: 'ferie' },
      { test: /^ROL/, campo: 'rol' },
      { test: /^EXFEST/, campo: 'exFestivita' },
      { test: /^BORE/, campo: 'bancaOre' },
    ];

    const inizio = righe.findIndex((r) => chiave(r.text).startsWith('RATEI'));
    if (inizio === -1) return;

    for (let i = inizio + 1; i < righe.length; i++) {
      const riga = righe[i];
      const k = chiave(riga.text);
      if (!k.includes('SALDO')) continue;
      const voce = mappa.find((m) => m.test.test(k));
      if (!voce) continue;
      const valori = leggiRigaRatei(riga, chiavi);
      const rateo: Rateo = {
        residuoAnnoPrec: valori.get('Res.AP') ?? 0,
        maturato: valori.get('Matur.') ?? 0,
        goduto: valori.get('Goduto') ?? 0,
        saldo: valori.get('Saldo') ?? 0,
      };
      c.ratei[voce.campo] = rateo;
    }
  }

  // ------------------------------------------------------------------ totali

  private totali(righe: Line[], c: Cedolino): void {
    const intTot = rigaCon(righe, 'TOT COMPETENZE', 'TOT TRATTENUTE');
    const valTot = intTot ? rigaSeguente(righe, intTot) : undefined;
    if (intTot && valTot) {
      const g = leggiGriglia(intTot, valTot);
      c.totali.competenze = g.get('TOTCOMPETENZE') ?? 0;
      c.totali.trattenute = g.get('TOTTRATTENUTE') ?? 0;
      c.totali.trattenutePrevFisc = g.get('TOTTRATTENUTEPREV/FISC');
      c.totali.arrotondamentoPrecedente = g.get('ARROTPRECED');
      c.totali.arrotondamentoAttuale = g.get('ARROTATTUALE');
    } else {
      c.anomalie.push('Riga dei totali non trovata.');
    }

    const intNetto = righe.find((r) => chiave(r.text) === 'NETTO');
    const valNetto = intNetto ? rigaSeguente(righe, intNetto) : undefined;
    if (intNetto && valNetto) {
      c.totali.netto = leggiGriglia(intNetto, valNetto).get('NETTO') ?? 0;
    }
    if (!c.totali.netto) {
      // Il netto è stampato con asterischi di riempimento: ****1377,00
      const riga = righe.find((r) => /\*{2,}[\d.,]+/.test(r.text));
      const m = riga ? /\*{2,}([\d.,]+)/.exec(riga.text) : null;
      if (m) c.totali.netto = aNumero(m[1]) ?? 0;
    }

    const intIrpef = rigaCon(righe, 'IMPOSTA LORDA', 'IMPOSTA NETTA');
    const valIrpef = intIrpef ? rigaSeguente(righe, intIrpef) : undefined;
    if (intIrpef && valIrpef) {
      const g = leggiGriglia(intIrpef, valIrpef);
      c.totali.irpefLorda = g.get('IMPOSTALORDA');
      c.totali.detrazioni = g.get('TOTDETR');
      c.totali.irpefNetta = g.get('IMPOSTANETTA');
    }

    const intImp = rigaCon(righe, 'DESCRIZIONE IMPONIBILE FISCALE', 'IMPONIBILI');
    const valImp = intImp ? rigaSeguente(righe, intImp) : undefined;
    if (intImp && valImp) {
      c.totali.imponibileFiscale = leggiGriglia(intImp, valImp).get('IMPONIBILI');
    }

    const intProg = rigaCon(righe, 'PROGR. IMPON. FISCALE', 'IMPOSTA PAGATA');
    const valProg = intProg ? rigaSeguente(righe, intProg) : undefined;
    if (intProg && valProg) {
      const g = leggiGriglia(intProg, valProg);
      c.progressivi = {
        imponibileFiscale: g.get('PROGRIMPONFISCALE'),
        impostaLorda: g.get('PROGRIMPLORDA'),
        detrazioni: g.get('DETRPROGRESSIVE'),
        impostaDovuta: g.get('IMPOSTADOVUTA'),
        impostaPagata: g.get('IMPOSTAPAGATA'),
      };
    }
  }

  /**
   * IRPEF e arrotondamenti non compaiono fra le righe voce: stanno nei riquadri
   * fiscali in fondo al cedolino. Vanno aggiunti all'elenco, altrimenti il
   * dettaglio non quadra con il totale.
   */
  private sintetizzaVociDaiTotali(c: Cedolino): void {
    const { irpefNetta, arrotondamentoPrecedente, arrotondamentoAttuale } = c.totali;

    const irpefGiaPresente = c.trattenute.some((v) => /IRPEF/i.test(v.descrizione));
    if (irpefNetta && !irpefGiaPresente) {
      c.trattenute.push({
        descrizione: 'IRPEF netta del mese',
        importo: irpefNetta,
        imponibile: c.totali.imponibileFiscale,
        colonna: 'trattenute',
        sintetica: true,
      });
    }
    if (arrotondamentoPrecedente) {
      c.trattenute.push({
        descrizione: 'Arrotondamento mese precedente',
        importo: arrotondamentoPrecedente,
        colonna: 'trattenute',
        sintetica: true,
      });
    }
    if (arrotondamentoAttuale) {
      c.competenze.push({
        descrizione: 'Arrotondamento del mese',
        importo: arrotondamentoAttuale,
        colonna: 'competenze',
        sintetica: true,
      });
    }
  }
}

// ------------------------------------------------------------------ utilità

function costruisciVoce(
  riga: Line,
  celle: Cella[],
  valori: { token: Token; valore: number }[],
  ultimo: { token: Token; valore: number },
  colonnaImporto: string,
): VoceImporto {
  const voce: VoceImporto = { descrizione: '', importo: ultimo.valore };

  const parole: string[] = [];
  for (const token of riga.tokens) {
    if (token === ultimo.token) continue;
    // Il codice voce può essere numerico (005, 152): va riconosciuto dalla
    // colonna, prima di scartare i numeri.
    if (!voce.codice && cellaDi(celle, token) === COL_CODICE && REGEX_CODICE_VOCE.test(token.text)) {
      voce.codice = token.text;
      continue;
    }
    if (aNumero(token.text) !== null) continue;
    parole.push(token.text);
  }
  voce.descrizione = parole.join(' ').replace(/^[*\s]+/, '').trim();

  for (const { token, valore } of valori) {
    if (token === ultimo.token) continue;
    const colonna = cellaDi(celle, token);
    if (colonnaImporto === COL_TRATTENUTE) {
      // Riga di contributo: imponibile e aliquota
      if (colonna === COL_UNITARIO) voce.imponibile = valore;
      if (colonna === COL_FIGURATI) voce.aliquota = valore;
    } else {
      if (colonna === COL_ORE) voce.ore = valore;
      if (colonna === COL_UNITARIO) voce.unitario = valore;
    }
  }
  return voce;
}

function titolo(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
