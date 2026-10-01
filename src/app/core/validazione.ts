import type { Cedolino, VoceImporto } from './cedolino.model';

const TOLLERANZA = 0.02;

/**
 * Controlli aritmetici comuni a tutti i formati.
 *
 * Un parser che sbaglia non solleva errori: restituisce numeri plausibili ma
 * falsi, ed è il modo più facile di prendere una decisione sbagliata su dati
 * veri. Queste identità sono l'unica difesa, e vanno eseguite per ogni parser.
 */
export function valida(c: Cedolino): void {
  const somma = (v: VoceImporto[]) => v.reduce((a, b) => a + b.importo, 0);

  if (!c.totali.netto) c.anomalie.push('Netto in busta non trovato.');
  if (!c.dipendente.codiceFiscale) c.anomalie.push('Codice fiscale non trovato.');
  if (!c.totali.competenze) c.anomalie.push('Totale competenze non trovato.');

  if (c.totali.netto && c.totali.competenze && !nettoCoerente(c)) {
    c.anomalie.push(
      `I totali non quadrano: ${euro(c.totali.competenze)} meno ${euro(c.totali.trattenute)} ` +
        `non dà ${euro(c.totali.netto)}, nemmeno tenendo conto degli arrotondamenti.`,
    );
  }

  const sommaComp = somma(c.competenze);
  if (c.competenze.length > 0 && Math.abs(sommaComp - c.totali.competenze) > TOLLERANZA) {
    c.anomalie.push(
      `Le competenze di dettaglio sommano ${euro(sommaComp)} invece di ` +
        `${euro(c.totali.competenze)}: alcune voci non sono state riconosciute.`,
    );
  }

  const sommaTratt = somma(c.trattenute);
  if (c.trattenute.length > 0 && Math.abs(sommaTratt - c.totali.trattenute) > TOLLERANZA) {
    c.anomalie.push(
      `Le trattenute di dettaglio sommano ${euro(sommaTratt)} invece di ` +
        `${euro(c.totali.trattenute)}: alcune voci non sono state riconosciute.`,
    );
  }
}

/**
 * Il netto è coerente con lordo e trattenute.
 *
 * Non basta la sottrazione secca: gli arrotondamenti al centesimo si comportano
 * diversamente da un gestionale all'altro. In alcuni modelli sono già dentro il
 * totale competenze, in altri stanno fuori pur essendo stampati nella stessa
 * colonna. Si accettano quindi tutte le combinazioni plausibili, e se nessuna
 * torna è un problema vero.
 */
export function nettoCoerente(c: Cedolino): boolean {
  return identitaNetto(c).some((v) => Math.abs(v - c.totali.netto) <= TOLLERANZA);
}

/** Valori che il netto può assumere a partire dai totali letti. */
export function identitaNetto(c: Cedolino): number[] {
  const base = c.totali.competenze - c.totali.trattenute;
  const attuale = c.totali.arrotondamentoAttuale ?? 0;
  const precedente = c.totali.arrotondamentoPrecedente ?? 0;
  return [base, base + attuale, base - precedente, base + attuale - precedente];
}

export function euro(v: number): string {
  return '€ ' + v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
