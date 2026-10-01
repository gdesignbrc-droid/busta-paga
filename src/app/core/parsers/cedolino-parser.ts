import type { Cedolino } from '../cedolino.model';
import type{ Line } from '../text-layer';

/**
 * Un parser per una famiglia di cedolini. Aggiungere il supporto a un nuovo
 * gestionale significa implementare questa interfaccia e registrarla in PARSERS.
 */
export interface CedolinoParser {
  /** Nome del formato, mostrato all'utente e salvato in Cedolino.formato */
  readonly formato: string;
  /** true se questo parser riconosce il documento */
  riconosce(righe: Line[]): boolean;
  analizza(righe: Line[]): Cedolino;
}

/**
 * Errore sollevato quando nessun parser riconosce il documento.
 *
 * Porta con sé le prime righe del testo effettivamente estratto: senza vedere
 * *cosa* ha letto il browser non si può capire se il problema è il formato, la
 * codifica dei font o la rotazione della pagina, e si finisce a indovinare.
 */
export class FormatoNonSupportatoError extends Error {
  readonly anteprima: string[];

  constructor(anteprima: string[] = []) {
    super(
      'Non riconosco la struttura di questo cedolino: non trovo i totali da cui parte ' +
        'la lettura. Qui sotto c’è il testo che ho estratto dal PDF, utile per capire perché.',
    );
    this.name = 'FormatoNonSupportatoError';
    this.anteprima = anteprima;
  }
}
