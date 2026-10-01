import { Injectable } from '@angular/core';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import type { Cedolino, VoceImporto } from './cedolino.model';

const A4 = { larghezza: 595.28, altezza: 841.89 };
const MARGINE = 45;

const ARANCIO = rgb(1, 0.357, 0.18);
const ARANCIO_SFONDO = rgb(0.965, 0.718, 0.608);
const VIOLA = rgb(0.486, 0.122, 0.91);
const VIOLA_SFONDO = rgb(0.863, 0.784, 0.969);
const VERDE = rgb(0.133, 0.627, 0.42);
const AMBRA = rgb(0.878, 0.658, 0);
const BLU = rgb(0.043, 0.369, 0.843);
const ROSSO = rgb(0.776, 0.157, 0.157);
const INCHIOSTRO = rgb(0.09, 0.196, 0.302);
const GRIGIO = rgb(0.357, 0.435, 0.51);
const GRIGIO_CHIARO = rgb(0.957, 0.957, 0.957);
const LINEA = rgb(0.875, 0.894, 0.914);
const FASCIA = rgb(0.945, 0.961, 0.976);
const FASCIA_BORDO = rgb(0.796, 0.835, 0.882);
const BIANCO = rgb(1, 1, 1);

type Allineamento = 'sx' | 'centro' | 'dx';

interface OpzioniTesto {
  size?: number;
  grassetto?: boolean;
  corsivo?: boolean;
  colore?: RGB;
  align?: Allineamento;
}

interface OpzioniScheda {
  riempimento?: RGB;
  bordo?: RGB;
  spessore?: number;
  raggio?: number;
}

/**
 * Genera il PDF di riepilogo. Tutto il disegno usa un sistema di coordinate
 * con l'origine in alto a sinistra (yAlto), più naturale da leggere:
 * la conversione verso pdf-lib avviene in un unico punto.
 */
@Injectable({ providedIn: 'root' })
export class RiepilogoPdfService {
  async genera(c: Cedolino): Promise<Blob> {
    const doc = await PDFDocument.create();
    doc.setTitle(`Riepilogo busta paga ${c.periodo.label}`);
    doc.setCreator('Riepilogo busta paga');

    const normale = await doc.embedFont(StandardFonts.Helvetica);
    const grassetto = await doc.embedFont(StandardFonts.HelveticaBold);
    const corsivo = await doc.embedFont(StandardFonts.HelveticaOblique);

    const tela = new Tela(doc, { normale, grassetto, corsivo });
    disegnaPaginaSintesi(tela, c);
    tela.nuovaPagina();
    disegnaPaginaDettaglio(tela, c);
    tela.piePagina(c);

    const bytes = await doc.save();
    return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  }
}

// ------------------------------------------------------------------- disegno

class Tela {
  pagina: PDFPage;
  /** cursore verticale, misurato dall'alto */
  y = MARGINE;
  readonly pagine: PDFPage[] = [];

  private readonly doc: PDFDocument;
  private readonly font: { normale: PDFFont; grassetto: PDFFont; corsivo: PDFFont };

  constructor(doc: PDFDocument, font: { normale: PDFFont; grassetto: PDFFont; corsivo: PDFFont }) {
    this.doc = doc;
    this.font = font;
    this.pagina = this.doc.addPage([A4.larghezza, A4.altezza]);
    this.pagine.push(this.pagina);
  }

  get larghezzaUtile(): number {
    return A4.larghezza - 2 * MARGINE;
  }

  nuovaPagina(): void {
    this.pagina = this.doc.addPage([A4.larghezza, A4.altezza]);
    this.pagine.push(this.pagina);
    this.y = MARGINE;
  }

  /** Va a pagina nuova se non c'è spazio per un blocco alto `altezza`. */
  assicuraSpazio(altezza: number): void {
    if (this.y + altezza > A4.altezza - MARGINE - 20) this.nuovaPagina();
  }

  scegliFont(o: OpzioniTesto): PDFFont {
    if (o.grassetto) return this.font.grassetto;
    if (o.corsivo) return this.font.corsivo;
    return this.font.normale;
  }

  larghezza(testo: string, o: OpzioniTesto = {}): number {
    return this.scegliFont(o).widthOfTextAtSize(soloWinAnsi(testo), o.size ?? 9);
  }

  /** Scrive `testo`: x è il bordo sinistro, il centro o il bordo destro. */
  testo(grezzo: string, x: number, yAlto: number, o: OpzioniTesto = {}): void {
    const testo = soloWinAnsi(grezzo);
    const size = o.size ?? 9;
    const font = this.scegliFont(o);
    const larghezza = font.widthOfTextAtSize(testo, size);
    const sinistra =
      o.align === 'centro' ? x - larghezza / 2 : o.align === 'dx' ? x - larghezza : x;
    this.pagina.drawText(testo, {
      x: sinistra,
      // yAlto indica il bordo superiore del testo
      y: A4.altezza - yAlto - size * 0.8,
      size,
      font,
      color: o.colore ?? INCHIOSTRO,
    });
  }

  scheda(x: number, yAlto: number, w: number, h: number, o: OpzioniScheda = {}): void {
    const raggio = o.raggio ?? 0;
    const y = A4.altezza - yAlto - h;
    if (raggio <= 0) {
      this.pagina.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        color: o.riempimento,
        borderColor: o.bordo,
        borderWidth: o.bordo ? (o.spessore ?? 1) : undefined,
      });
      return;
    }
    // drawSvgPath disegna con l'asse y rivolto verso il basso a partire
    // dal punto indicato: yAlto è quindi già l'angolo superiore.
    this.pagina.drawSvgPath(pathArrotondato(w, h, raggio), {
      x,
      y: A4.altezza - yAlto,
      color: o.riempimento,
      borderColor: o.bordo,
      borderWidth: o.bordo ? (o.spessore ?? 1) : undefined,
    });
  }

  linea(x1: number, yAlto: number, x2: number, colore: RGB = LINEA): void {
    this.pagina.drawLine({
      start: { x: x1, y: A4.altezza - yAlto },
      end: { x: x2, y: A4.altezza - yAlto },
      thickness: 0.8,
      color: colore,
    });
  }

  /** Spezza il testo in righe che stanno entro `larghezzaMax`. */
  spezza(testo: string, larghezzaMax: number, o: OpzioniTesto = {}): string[] {
    const parole = testo.split(/\s+/);
    const righe: string[] = [];
    let corrente = '';
    for (const parola of parole) {
      const prova = corrente ? `${corrente} ${parola}` : parola;
      if (this.larghezza(prova, o) > larghezzaMax && corrente) {
        righe.push(corrente);
        corrente = parola;
      } else {
        corrente = prova;
      }
    }
    if (corrente) righe.push(corrente);
    return righe;
  }

  paragrafo(testo: string, o: OpzioniTesto = {}): void {
    const size = o.size ?? 9.3;
    const interlinea = size * 1.4;
    const righe = this.spezza(testo, this.larghezzaUtile, { ...o, size });
    this.assicuraSpazio(righe.length * interlinea);
    for (const riga of righe) {
      this.testo(riga, MARGINE, this.y, { ...o, size, colore: o.colore ?? GRIGIO });
      this.y += interlinea;
    }
    this.y += 5;
  }

  piePagina(c: Cedolino): void {
    const nota = soloWinAnsi(
      `Riepilogo generato dal cedolino ${c.periodo.label} – formato ${c.formato}. ` +
        'Documento di sola lettura, non ha valore fiscale.',
    );
    for (const pagina of this.pagine) {
      const size = 7.5;
      const larghezza = this.font.corsivo.widthOfTextAtSize(nota, size);
      pagina.drawText(nota, {
        x: (A4.larghezza - larghezza) / 2,
        y: MARGINE - 22,
        size,
        font: this.font.corsivo,
        color: GRIGIO,
      });
    }
  }
}

/**
 * I font standard di pdf-lib (Helvetica e simili) usano la codifica WinAnsi, che
 * copre l'alfabeto latino ma non i simboli tipografici moderni: un carattere
 * fuori tabella fa fallire la generazione con "WinAnsi cannot encode".
 *
 * Il testo di un cedolino arriva da fonti non controllate (ragioni sociali,
 * descrizioni voce), quindi ogni stringa passa da qui: i caratteri noti vengono
 * sostituiti con un equivalente, gli sconosciuti con un punto interrogativo,
 * ma in nessun caso il PDF fallisce.
 *
 * L'alternativa, se un giorno servissero altri alfabeti, è incorporare un font
 * TrueType con fontkit e passare a Unicode.
 */
const SOSTITUZIONI = new Map<string, string>([
  ['→', '>'], // freccia destra
  ['←', '<'],
  ['↔', '<>'],
  ['⇒', '=>'],
  ['−', '-'], // segno meno
  ['‑', '-'], // trattino non divisibile
  ['⁄', '/'], // barra di frazione
  [' ', ' '], // spazio non divisibile
  ['​', ''],
  [' ', ' '],
  [' ', ' '],
  ['′', "'"],
  ['″', '"'],
  ['≤', '<='],
  ['≥', '>='],
  ['×', 'x'],
]);

/** Punti di codice ammessi da WinAnsi oltre a Latin-1. */
const EXTRA_WINANSI = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function soloWinAnsi(testo: string): string {
  let out = '';
  for (const carattere of testo) {
    const sostituto = SOSTITUZIONI.get(carattere);
    if (sostituto !== undefined) {
      out += sostituto;
      continue;
    }
    const codice = carattere.codePointAt(0) ?? 0;
    const ammesso =
      (codice >= 0x20 && codice <= 0x7e) ||
      (codice >= 0xa1 && codice <= 0xff) ||
      EXTRA_WINANSI.has(codice);
    out += ammesso ? carattere : '?';
  }
  return out;
}

function pathArrotondato(w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return (
    `M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} ` +
    `V ${h - rr} A ${rr} ${rr} 0 0 1 ${w - rr} ${h} ` +
    `H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} ` +
    `V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`
  );
}

// --------------------------------------------------------- pagina 1: sintesi

function disegnaPaginaSintesi(t: Tela, c: Cedolino): void {
  const destra = A4.larghezza - MARGINE;

  t.testo('LA TUA BUSTA PAGA', MARGINE, t.y, { size: 17, grassetto: true });
  t.testo(c.periodo.label.toUpperCase(), MARGINE, t.y + 21, {
    size: 13,
    grassetto: true,
    colore: ARANCIO,
  });

  const intestazioneDx = [
    { testo: c.dipendente.nome, o: { size: 10.5, grassetto: true } as OpzioniTesto },
    { testo: c.dipendente.codiceFiscale, o: { size: 9, colore: GRIGIO } as OpzioniTesto },
    { testo: rigaQualifica(c), o: { size: 9, colore: GRIGIO } as OpzioniTesto },
    { testo: rigaAzienda(c), o: { size: 9, colore: GRIGIO } as OpzioniTesto },
  ];
  let yDx = t.y - 4;
  for (const riga of intestazioneDx) {
    if (riga.testo) t.testo(riga.testo, destra, yDx, { ...riga.o, align: 'dx' });
    yDx += 12.5;
  }

  t.y += 52;
  t.linea(MARGINE, t.y, destra);
  t.y += 12;

  // --- due colonne: competenze e trattenute
  const colonna = (t.larghezzaUtile - 22) / 2;
  const xSx = MARGINE;
  const xDx = MARGINE + colonna + 22;

  const vociSx = accorpa(c.competenze, 4);
  const vociDx = accorpa(c.trattenute, 4);
  const righe = Math.max(vociSx.length, vociDx.length);

  const altezzaEroe = 84;
  const altezzaRiga = 37;
  const spazioRiga = 7;
  const altezzaColonna =
    14 + altezzaEroe + 24 + righe * altezzaRiga + (righe - 1) * spazioRiga + 14;

  t.scheda(xSx, t.y, colonna, altezzaColonna, { riempimento: ARANCIO_SFONDO, raggio: 9 });
  t.scheda(xDx, t.y, colonna, altezzaColonna, { riempimento: VIOLA_SFONDO, raggio: 9 });

  eroe(t, xSx + 14, t.y + 14, colonna - 28, altezzaEroe, 'RETRIBUZIONE LORDA', euro(c.totali.competenze), ARANCIO);
  eroe(t, xDx + 14, t.y + 14, colonna - 28, altezzaEroe, 'CONTRIBUTI E TASSE', '- ' + euro(c.totali.trattenute), VIOLA);

  const yDiCui = t.y + 14 + altezzaEroe + 8;
  t.testo('di cui', xSx + colonna / 2, yDiCui, { size: 9.5, corsivo: true, align: 'centro' });
  t.testo('di cui', xDx + colonna / 2, yDiCui, { size: 9.5, corsivo: true, align: 'centro' });

  const yRighe = yDiCui + 16;
  for (let i = 0; i < righe; i++) {
    const y = yRighe + i * (altezzaRiga + spazioRiga);
    if (vociSx[i]) vociScheda(t, xSx + 14, y, colonna - 28, altezzaRiga, vociSx[i], ARANCIO);
    if (vociDx[i]) vociScheda(t, xDx + 14, y, colonna - 28, altezzaRiga, vociDx[i], VIOLA);
  }
  t.y += altezzaColonna + 18;

  // --- netto
  const altezzaNetto = 74;
  t.scheda(MARGINE, t.y, t.larghezzaUtile, altezzaNetto, { riempimento: VERDE, raggio: 9 });
  t.testo('NETTO IN BUSTA', A4.larghezza / 2, t.y + 14, {
    size: 15,
    grassetto: true,
    colore: BIANCO,
    align: 'centro',
  });
  t.testo(euro(c.totali.netto), A4.larghezza / 2, t.y + 34, {
    size: 30,
    grassetto: true,
    colore: BIANCO,
    align: 'centro',
  });
  t.y += altezzaNetto + 16;

  // --- riquadri ferie, permessi, TFR
  const riquadri = costruisciRiquadri(c);
  if (riquadri.length > 0) {
    const gap = 11;
    const larghezza = (t.larghezzaUtile - (riquadri.length - 1) * gap) / riquadri.length;
    const altezza = 54;
    riquadri.forEach((r, i) => {
      const x = MARGINE + i * (larghezza + gap);
      t.scheda(x, t.y, larghezza, altezza, {
        riempimento: BIANCO,
        bordo: r.colore,
        spessore: 1.5,
        raggio: 5,
      });
      const centro = x + larghezza / 2;
      t.testo(r.etichetta, centro, t.y + 8, { size: 8, grassetto: true, align: 'centro' });
      t.testo(r.valore, centro, t.y + 21, {
        size: 12,
        grassetto: true,
        colore: r.colore,
        align: 'centro',
      });
      t.testo(r.nota, centro, t.y + 38, { size: 7, colore: GRIGIO, align: 'centro' });
    });
    t.y += altezza + 16;
  }

  // --- fuori busta
  const extra = rigaFuoriBusta(c);
  if (extra) {
    const altezza = 42;
    t.scheda(MARGINE, t.y, t.larghezzaUtile, altezza, {
      riempimento: FASCIA,
      bordo: FASCIA_BORDO,
      spessore: 1,
      raggio: 6,
    });
    t.testo('IN AGGIUNTA, FUORI DAL CEDOLINO', MARGINE + 14, t.y + 11, {
      size: 9,
      grassetto: true,
    });
    t.testo(extra, MARGINE + 14, t.y + 25, { size: 9, colore: GRIGIO });
    t.y += altezza + 16;
  }

  // --- avvisi
  if (c.anomalie.length > 0) {
    const righeAvviso = c.anomalie.flatMap((a) => t.spezza('• ' + a, t.larghezzaUtile - 28, { size: 9 }));
    const altezza = 26 + righeAvviso.length * 12;
    t.scheda(MARGINE, t.y, t.larghezzaUtile, altezza, {
      riempimento: rgb(0.996, 0.949, 0.949),
      bordo: ROSSO,
      spessore: 1.2,
      raggio: 6,
    });
    t.testo('DA VERIFICARE SUL CEDOLINO ORIGINALE', MARGINE + 14, t.y + 9, {
      size: 9,
      grassetto: true,
      colore: ROSSO,
    });
    righeAvviso.forEach((riga, i) => {
      t.testo(riga, MARGINE + 14, t.y + 23 + i * 12, { size: 9, colore: ROSSO });
    });
    t.y += altezza + 16;
  }
}

function eroe(
  t: Tela,
  x: number,
  y: number,
  w: number,
  h: number,
  titolo: string,
  valore: string,
  colore: RGB,
): void {
  t.scheda(x, y, w, h, { riempimento: colore, raggio: 9 });
  t.testo(titolo, x + w / 2, y + 16, { size: 13, grassetto: true, colore: BIANCO, align: 'centro' });
  t.testo(valore, x + w / 2, y + 40, { size: 27, grassetto: true, colore: BIANCO, align: 'centro' });
}

function vociScheda(
  t: Tela,
  x: number,
  y: number,
  w: number,
  h: number,
  voce: VoceImporto,
  colore: RGB,
): void {
  t.scheda(x, y, w, h, {
    riempimento: GRIGIO_CHIARO,
    bordo: colore,
    spessore: 1.3,
    raggio: 5,
  });
  const centro = x + w / 2;
  const etichetta = tronca(t, voce.descrizione.toUpperCase(), w - 12, { size: 8.5, grassetto: true });
  t.testo(etichetta, centro, y + 7, { size: 8.5, grassetto: true, align: 'centro' });
  t.testo(dettaglioVoce(voce), centro, y + 20, { size: 11, align: 'centro' });
}

function dettaglioVoce(voce: VoceImporto): string {
  if (voce.ore) return `${numero(voce.ore)} ore — ${euro(voce.importo)}`;
  if (voce.aliquota) return `${numero(voce.aliquota)}% — ${euro(voce.importo)}`;
  return euro(voce.importo);
}

// ------------------------------------------------------- pagina 2: dettaglio

function disegnaPaginaDettaglio(t: Tela, c: Cedolino): void {
  t.testo('COME SI LEGGE, VOCE PER VOCE', MARGINE, t.y, { size: 15, grassetto: true });
  t.y += 30;

  sezione(t, 'Quanto hai guadagnato (competenze)');
  for (const v of c.competenze) {
    rigaValore(t,v.descrizione, euro(v.importo), notaCompetenza(v, c));
  }
  rigaValore(t,'TOTALE COMPETENZE', euro(c.totali.competenze), '');
  t.y += 6;
  if (c.pagaOraria) {
    t.paragrafo(
      `La paga oraria di riferimento è ${numero(c.pagaOraria, 5)} euro. ` + frasePresenze(c),
    );
  }

  sezione(t, 'Cosa è stato trattenuto');
  for (const v of c.trattenute) {
    rigaValore(t,v.descrizione, euro(v.importo), notaTrattenuta(v));
  }
  if (c.totali.irpefLorda !== undefined && c.totali.detrazioni !== undefined) {
    t.y += 4;
    rigaValore(t,'IRPEF lorda del mese', euro(c.totali.irpefLorda), 'prima delle detrazioni');
    rigaValore(t,'Detrazioni da lavoro dipendente', '- ' + euro(c.totali.detrazioni), 'riducono l’IRPEF');
  }
  rigaValore(t,'TOTALE TRATTENUTE', euro(c.totali.trattenute), '');
  t.y += 6;
  t.paragrafo(fraseCarico(c));

  sezione(t, 'Il conto finale');
  rigaValore(t,'Lordo', euro(c.totali.competenze), '');
  rigaValore(t,'Meno trattenute', '- ' + euro(c.totali.trattenute), '');
  rigaValore(t,'NETTO PAGATO', euro(c.totali.netto), c.iban ? `bonifico su ${mascheraIban(c.iban)}` : '');
  t.y += 6;

  const ratei = elencoRatei(c);
  if (ratei.length > 0) {
    sezione(t, 'Ferie, permessi ed ex festività');
    for (const r of ratei) rigaValore(t, r.etichetta, r.valore, r.nota);
    t.y += 6;
    const avviso = fraseFerie(c);
    if (avviso) t.paragrafo(avviso);
  }

  if (c.tfrMese || c.presenze.giorniInps) {
    sezione(t, 'TFR e previdenza');
    if (c.tfrMese) {
      const quota = c.totali.competenze
        ? ` circa il ${numero((c.tfrMese / c.totali.competenze) * 100, 1)}% del lordo`
        : '';
      rigaValore(t,'TFR accantonato nel mese', euro(c.tfrMese), quota.trim());
    }
    const inps = c.trattenute.find((v) => /INPS/i.test(v.descrizione));
    if (inps) rigaValore(t, 'Contributi INPS versati', euro(inps.importo), 'utili ai fini pensionistici');
    if (c.presenze.giorniInps) {
      rigaValore(t,'Giorni INPS accreditati', numero(c.presenze.giorniInps), c.periodo.label);
    }
    t.y += 6;
  }

  const p = c.progressivi;
  if (p.imponibileFiscale || p.impostaPagata) {
    sezione(t, 'Progressivi dell’anno');
    if (p.imponibileFiscale) rigaValore(t, 'Imponibile fiscale progressivo', euro(p.imponibileFiscale), '');
    if (p.impostaLorda) rigaValore(t, 'Imposta lorda progressiva', euro(p.impostaLorda), '');
    if (p.detrazioni) rigaValore(t, 'Detrazioni progressive', euro(p.detrazioni), '');
    if (p.impostaPagata) rigaValore(t, 'Imposta pagata', euro(p.impostaPagata), '');
  }
}

function sezione(t: Tela, titolo: string): void {
  t.assicuraSpazio(40);
  t.pagina.drawRectangle({
    x: MARGINE,
    y: A4.altezza - t.y - 12,
    width: 2.5,
    height: 12,
    color: ARANCIO,
  });
  t.testo(titolo, MARGINE + 11, t.y, { size: 11, grassetto: true });
  t.y += 19;
}

function rigaValore(t: Tela, etichetta: string, valore: string, nota: string): void {
  t.assicuraSpazio(14);
  const xValore = MARGINE + 300;
  t.testo(tronca(t, etichetta, 285, { size: 9, grassetto: true }), MARGINE, t.y, {
    size: 9,
    grassetto: true,
  });
  t.testo(valore, xValore, t.y, { size: 9, align: 'dx' });
  if (nota) {
    t.testo(tronca(t, nota, t.larghezzaUtile - 320, { size: 8.3, corsivo: true }), xValore + 16, t.y, {
      size: 8.3,
      corsivo: true,
      colore: GRIGIO,
    });
  }
  t.y += 13.5;
}

// ------------------------------------------------------------------ contenuti

function accorpa(voci: VoceImporto[], massimo: number): VoceImporto[] {
  if (voci.length <= massimo) return voci;
  const ordinate = [...voci].sort((a, b) => b.importo - a.importo);
  const principali = ordinate.slice(0, massimo - 1);
  const resto = ordinate.slice(massimo - 1);
  return [
    ...principali,
    {
      descrizione: `Altre ${resto.length} voci`,
      importo: resto.reduce((a, b) => a + b.importo, 0),
    },
  ];
}

function costruisciRiquadri(
  c: Cedolino,
): { etichetta: string; valore: string; nota: string; colore: RGB }[] {
  const out: { etichetta: string; valore: string; nota: string; colore: RGB }[] = [];
  const ferie = c.ratei.ferie;
  if (ferie) {
    out.push({
      etichetta: 'FERIE RESIDUE',
      valore: `${numero(ferie.saldo)} giorni`,
      nota: ferie.saldo < 0 ? 'saldo negativo' : 'disponibili',
      colore: ferie.saldo < 0 ? ROSSO : VERDE,
    });
  }
  const ex = c.ratei.exFestivita;
  if (ex && (ex.saldo || ex.maturato)) {
    out.push({
      etichetta: 'EX FESTIVITÀ',
      valore: `${numero(ex.saldo)} giorni`,
      nota: 'maturate, non godute',
      colore: AMBRA,
    });
  }
  const rol = c.ratei.rol;
  if (rol) {
    out.push({
      etichetta: 'R.O.L. RESIDUI',
      valore: `${numero(rol.saldo)} ore`,
      nota: rol.saldo ? 'disponibili' : 'nessun rateo',
      colore: AMBRA,
    });
  }
  if (c.tfrMese) {
    out.push({
      etichetta: 'TFR DEL MESE',
      valore: euro(c.tfrMese),
      nota: 'accantonato',
      colore: BLU,
    });
  }
  return out.slice(0, 4);
}

function rigaFuoriBusta(c: Cedolino): string {
  const pezzi: string[] = [];
  for (const v of c.figurativi) {
    if (/TFR/i.test(v.descrizione)) continue;
    const unita = v.ore ? `${numero(v.ore)} x ${euro(v.unitario ?? 0)} = ` : '';
    pezzi.push(`${v.descrizione}: ${unita}${euro(v.importo)}`);
  }
  const { giorniLavorati, giorniRetribuiti } = c.presenze;
  if (giorniLavorati && giorniRetribuiti) {
    pezzi.push(`giorni lavorati ${numero(giorniLavorati)} su ${numero(giorniRetribuiti)} retribuiti`);
  }
  return pezzi.join('  •  ');
}

function elencoRatei(c: Cedolino): { etichetta: string; valore: string; nota: string }[] {
  const out: { etichetta: string; valore: string; nota: string }[] = [];
  const ferie = c.ratei.ferie;
  if (ferie) {
    out.push({
      etichetta: 'Ferie maturate',
      valore: `${numero(ferie.maturato)} giorni`,
      nota: c.dipendente.dataAssunzione ? `dall’assunzione (${c.dipendente.dataAssunzione})` : '',
    });
    out.push({ etichetta: 'Ferie godute', valore: `${numero(ferie.goduto)} giorni`, nota: c.periodo.label });
    out.push({
      etichetta: 'Saldo ferie',
      valore: `${numero(ferie.saldo)} giorni`,
      nota: ferie.saldo < 0 ? 'ferie anticipate' : 'disponibili',
    });
  }
  const ex = c.ratei.exFestivita;
  if (ex) out.push({ etichetta: 'Ex festività', valore: `${numero(ex.saldo)} giorni`, nota: 'saldo' });
  const rol = c.ratei.rol;
  if (rol) out.push({ etichetta: 'R.O.L.', valore: numero(rol.saldo), nota: rol.saldo ? 'saldo' : 'nessun rateo maturato' });
  const banca = c.ratei.bancaOre;
  if (banca) {
    out.push({
      etichetta: 'Banca ore',
      valore: numero(banca.saldo),
      nota: banca.saldo ? 'saldo' : 'non alimentata',
    });
  }
  return out;
}

function notaCompetenza(v: VoceImporto, c: Cedolino): string {
  if (v.ore && v.unitario) return `${numero(v.ore)} ore x ${numero(v.unitario, 5)}`;
  if (v.ore) return `${numero(v.ore)} ore`;
  if (v.sintetica) return 'arrotondamento tecnico';
  if (/ferie/i.test(v.descrizione)) return 'pagate come lavorate';
  if (/indennit|bonus/i.test(v.descrizione)) return `in busta, ${c.periodo.label}`;
  return '';
}

function notaTrattenuta(v: VoceImporto): string {
  if (v.aliquota && v.imponibile) return `${numero(v.aliquota)}% su ${euro(v.imponibile)}`;
  if (v.imponibile) return `su imponibile ${euro(v.imponibile)}`;
  if (v.sintetica && /arrotondamento/i.test(v.descrizione)) return 'conguaglio tecnico';
  return '';
}

function frasePresenze(c: Cedolino): string {
  const { giorniLavorati, giorniRetribuiti, oreLavorate } = c.presenze;
  if (!giorniLavorati || !giorniRetribuiti) return '';
  const differenza = giorniRetribuiti - giorniLavorati;
  const ore = oreLavorate ? `${numero(oreLavorate)} ore lavorate, ` : '';
  const coperto =
    differenza > 0
      ? ` La differenza di ${numero(differenza)} giorni è coperta da ferie, permessi o festività.`
      : '';
  return `Nel mese risultano ${ore}${numero(giorniLavorati)} giorni lavorati su ${numero(giorniRetribuiti)} retribuiti.${coperto}`;
}

function fraseCarico(c: Cedolino): string {
  if (!c.totali.competenze) return '';
  const percentuale = (c.totali.trattenute / c.totali.competenze) * 100;
  let frase =
    `Il carico fiscale e contributivo effettivo è il ${numero(percentuale, 1)}% del lordo. `;
  if (c.totali.irpefLorda && c.totali.detrazioni) {
    const quota = (c.totali.detrazioni / c.totali.irpefLorda) * 100;
    frase +=
      `Le detrazioni da lavoro dipendente coprono il ${numero(quota, 0)}% dell’IRPEF lorda, ` +
      'ed è questo che tiene bassa l’imposta effettivamente pagata.';
  }
  return frase;
}

function fraseFerie(c: Cedolino): string {
  const ferie = c.ratei.ferie;
  if (!ferie) return '';
  if (ferie.saldo < 0) {
    return (
      `Il saldo ferie è negativo di ${numero(Math.abs(ferie.saldo))} giorni: ne hai godute ` +
      `${numero(ferie.goduto)} a fronte di ${numero(ferie.maturato)} maturate, quindi sono state ` +
      'anticipate e verranno riassorbite con i ratei dei mesi successivi. Fino a quel momento, in ' +
      'caso di cessazione del rapporto, i giorni anticipati sarebbero trattenuti a conguaglio.'
    );
  }
  return `Hai ${numero(ferie.saldo)} giorni di ferie disponibili, al netto di quelle già godute.`;
}

// -------------------------------------------------------------------- utilità

function rigaQualifica(c: Cedolino): string {
  const pezzi: string[] = [];
  if (c.dipendente.matricola) pezzi.push(`matricola #${c.dipendente.matricola}`);
  if (c.dipendente.qualifica) {
    pezzi.push(c.dipendente.livello ? `${c.dipendente.qualifica}, liv. ${c.dipendente.livello}` : c.dipendente.qualifica);
  }
  return pezzi.join('  •  ');
}

function rigaAzienda(c: Cedolino): string {
  if (c.azienda.utilizzatrice) return `${c.azienda.nome}  presso  ${c.azienda.utilizzatrice}`;
  return c.azienda.nome;
}

function mascheraIban(iban: string): string {
  return iban.length > 12 ? `${iban.slice(0, 8)}...${iban.slice(-5)}` : iban;
}

function tronca(t: Tela, testo: string, larghezzaMax: number, o: OpzioniTesto): string {
  if (t.larghezza(testo, o) <= larghezzaMax) return testo;
  let corrente = testo;
  while (corrente.length > 1 && t.larghezza(corrente + '…', o) > larghezzaMax) {
    corrente = corrente.slice(0, -1);
  }
  return corrente.trimEnd() + '…';
}

export function euro(v: number): string {
  return '€ ' + v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function numero(v: number, decimali = 2): string {
  const arrotondato = Number(v.toFixed(decimali));
  return arrotondato.toLocaleString('it-IT', { maximumFractionDigits: decimali });
}
