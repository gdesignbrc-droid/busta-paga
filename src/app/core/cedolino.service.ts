import { Injectable, inject } from '@angular/core';
import type { Cedolino } from './cedolino.model';
import { PdfTextService } from './pdf-text.service';
import { RiepilogoPdfService } from './riepilogo-pdf.service';
import { costruisciRighe } from './text-layer';
import type { Line } from './text-layer';
import type { CedolinoParser } from './parsers/cedolino-parser';
import { FormatoNonSupportatoError } from './parsers/cedolino-parser';
import { ZucchettiParser } from './parsers/zucchetti.parser';
import { GenericoParser } from './parsers/generico.parser';

export interface Risultato {
  cedolino: Cedolino;
  pdf: Blob;
}

/**
 * Orchestra le tre fasi: estrazione del testo, parsing, generazione del
 * riepilogo. Tutto avviene nel browser: nessuna richiesta di rete.
 *
 * Per supportare un nuovo gestionale basta aggiungere un parser a `parsers`.
 */
@Injectable({ providedIn: 'root' })
export class CedolinoService {
  private readonly testo = inject(PdfTextService);
  private readonly generatore = inject(RiepilogoPdfService);

  /**
   * L'ordine conta: i parser dedicati vanno prima, perché estraggono più
   * dettagli (aliquote, ratei, TFR). Il generico è l'ultimo e fa da rete di
   * sicurezza per tutti i modelli che nessuno ha ancora studiato.
   */
  private readonly parsers: CedolinoParser[] = [new ZucchettiParser(), new GenericoParser()];

  async elabora(file: File): Promise<Risultato> {
    const items = await this.testo.estrai(file);
    if (items.length === 0) {
      throw new Error(
        'Il PDF non contiene testo selezionabile: probabilmente è una scansione. ' +
          'Serve il cedolino originale scaricato dal portale, non una fotografia.',
      );
    }

    const righe = costruisciRighe(items);

    // Alcuni cedolini incorporano font senza mappatura Unicode: i glifi vengono
    // scartati durante la pulizia e resta una pagina quasi vuota. Meglio dirlo
    // che lasciar credere a un formato non supportato.
    const caratteriUtili = righe
      .map((r) => r.text)
      .join('')
      .replace(/[^A-Za-z0-9]/g, '').length;
    if (caratteriUtili < 100) {
      throw new Error(
        'Dal PDF non esce testo leggibile: i font incorporati non hanno una mappatura ' +
          'Unicode utilizzabile. Serve il cedolino originale scaricato dal portale paghe.',
      );
    }

    const parser = this.parsers.find((p) => p.riconosce(righe));
    if (!parser) throw new FormatoNonSupportatoError(anteprima(righe));

    const cedolino = parser.analizza(righe);
    const pdf = await this.generatore.genera(cedolino);
    return { cedolino, pdf };
  }
}

/** Righe più significative del documento, da mostrare quando il parsing fallisce. */
function anteprima(righe: Line[], massimo = 25): string[] {
  return righe
    .map((r) => r.text.trim())
    .filter((t) => t.replace(/[^A-Za-z0-9]/g, '').length >= 3)
    .slice(0, massimo)
    .map((t) => (t.length > 160 ? t.slice(0, 160) + '…' : t));
}
