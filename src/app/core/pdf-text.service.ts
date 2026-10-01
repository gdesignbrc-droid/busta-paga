import { Injectable } from '@angular/core';
import type { TextItem } from './text-layer';

/** Sottoinsieme dell'item di pdf.js che ci serve, per non dipendere dai suoi tipi. */
interface ItemPdfJs {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

/** Distanza verticale virtuale fra una pagina e la successiva. */
const SALTO_PAGINA = 200;

/**
 * Estrae i token di testo con le loro coordinate da un PDF, interamente nel
 * browser. Il file non viene mai inviato a un server.
 */
@Injectable({ providedIn: 'root' })
export class PdfTextService {
  async estrai(file: File): Promise<TextItem[]> {
    const pdfjs = await import('pdfjs-dist');

    // Il worker è copiato fra gli asset (vedi angular.json). Il percorso va
    // risolto rispetto a document.baseURI e non lasciato relativo: su GitHub
    // Pages il sito vive in una sottocartella (/nome-repository/), e un percorso
    // relativo verrebbe cercato nella posizione sbagliata.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;

    const dati = new Uint8Array(await file.arrayBuffer());
    const documento = await pdfjs.getDocument({ data: dati, isEvalSupported: false }).promise;

    const items: TextItem[] = [];
    try {
      for (let numero = 1; numero <= documento.numPages; numero++) {
        const pagina = await documento.getPage(numero);
        const viewport = pagina.getViewport({ scale: 1 });
        const contenuto = await pagina.getTextContent();
        const offset = (numero - 1) * (viewport.height + SALTO_PAGINA);

        for (const grezzo of contenuto.items) {
          const item = grezzo as unknown as ItemPdfJs;
          if (typeof item.str !== 'string' || item.str.trim() === '') continue;

          // La matrice dell'item è nello spazio della pagina non ruotata. Va
          // composta con quella del viewport, altrimenti su una pagina con
          // /Rotate 90 (non raro: molti cedolini sono stampati in orizzontale)
          // righe e colonne risultano scambiate. Il viewport porta già
          // l'origine in alto a sinistra.
          const m = pdfjs.Util.transform(viewport.transform, item.transform);
          const x = m[4];
          const y = m[5];

          // Il viewport ruota la pagina perché il testo risulti orizzontale a
          // schermo, e una rotazione conserva le lunghezze: con scala 1 la
          // larghezza dell'item è già quella orizzontale in punti.
          const larghezza = item.width ?? 0;
          const corpo = item.height && item.height > 0 ? item.height : undefined;

          for (const parola of dividiInParole(item.str, x, larghezza)) {
            items.push({ ...parola, y: y + offset, corpo });
          }
        }
      }
    } finally {
      await documento.destroy();
    }
    return items;
  }
}

/**
 * Divide un frammento di testo nelle parole che lo compongono, stimandone la
 * posizione orizzontale.
 *
 * pdf.js restituisce il testo così come il PDF lo disegna, e la granularità
 * cambia radicalmente da un documento all'altro: alcuni emettono una parola per
 * volta, altri un carattere per volta, altri un'intera riga con gli spazi
 * dentro. Le colonne si riconoscono dal bordo destro di ogni valore, quindi un
 * frammento che contiene più campi separati da spazi va spezzato, altrimenti il
 * suo bordo destro appartiene all'ultimo campo e tutti gli altri lo perdono.
 *
 * La stima è proporzionale al numero di caratteri: approssimativa con i font
 * proporzionali, esatta con quelli a spaziatura fissa (i più usati nei cedolini),
 * e in ogni caso sufficiente perché conta solo il bordo destro di ogni parola.
 */
export function dividiInParole(
  testo: string,
  x: number,
  larghezza: number,
): { text: string; x: number; x2: number }[] {
  if (testo.trim() === '') return [];
  if (!/\s/.test(testo.trim()) && !/^\s|\s$/.test(testo)) {
    return [{ text: testo, x, x2: x + larghezza }];
  }

  const perCarattere = testo.length > 0 ? larghezza / testo.length : 0;
  const out: { text: string; x: number; x2: number }[] = [];
  const regex = /\S+/g;
  let trovata: RegExpExecArray | null;
  while ((trovata = regex.exec(testo)) !== null) {
    const inizio = x + trovata.index * perCarattere;
    out.push({
      text: trovata[0],
      x: inizio,
      x2: inizio + trovata[0].length * perCarattere,
    });
  }
  return out;
}
