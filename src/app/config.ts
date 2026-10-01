/**
 * Le due cose da personalizzare prima di pubblicare. Tutto il resto del codice
 * legge da qui, così non serve cercare nulla altrove.
 */

/**
 * Indirizzo a cui arrivano le segnalazioni dei cedolini non riconosciuti.
 *
 * Lasciandolo vuoto il pulsante di segnalazione non viene mostrato, e resta solo
 * quello che copia il testo negli appunti: l'app funziona comunque.
 *
 * Attenzione: l'email contiene solo il testo estratto dal PDF, mai il PDF. Il
 * testo però include il nome e gli importi di chi l'ha generata, quindi va
 * chiesto il consenso — nell'interfaccia è scritto chiaramente.
 */
export const EMAIL_SEGNALAZIONI = 'gdesignbrc@gmail.com';

/** Nome mostrato nell'intestazione della pagina. */
export const NOME_APP = 'Riepilogo busta paga';

/** Limite prudente per il corpo di un link mailto, che molti client troncano. */
const LIMITE_MAILTO = 1500;

/**
 * Compone il link mailto per segnalare un formato non riconosciuto.
 * Restituisce null se non c'è un destinatario configurato.
 */
export function linkSegnalazione(anteprima: string[]): string | null {
  if (!EMAIL_SEGNALAZIONI) return null;

  const intestazione =
    'Questo cedolino non è stato riconosciuto. Di seguito il testo che l’applicazione ' +
    'ha estratto dal PDF (il PDF non è allegato).\n\n';

  let corpo = intestazione;
  for (const riga of anteprima) {
    if (corpo.length + riga.length + 1 > LIMITE_MAILTO) {
      corpo += '[…testo troncato]';
      break;
    }
    corpo += riga + '\n';
  }

  const oggetto = 'Cedolino non riconosciuto';
  return (
    `mailto:${encodeURIComponent(EMAIL_SEGNALAZIONI)}` +
    `?subject=${encodeURIComponent(oggetto)}` +
    `&body=${encodeURIComponent(corpo)}`
  );
}
