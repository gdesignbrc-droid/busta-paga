/**
 * Modello dati di un cedolino, indipendente dal formato del PDF di partenza.
 * Ogni parser (Zucchetti, Inaz, TeamSystem...) deve produrre questa struttura.
 */

export interface VoceImporto {
  /** Codice voce del gestionale, se presente (es. AA245, 005, WZF081) */
  codice?: string;
  descrizione: string;
  /** Importo in euro, sempre positivo anche per le trattenute */
  importo: number;
  ore?: number;
  unitario?: number;
  /** Per le trattenute: la base di calcolo (imponibile previdenziale o fiscale) */
  imponibile?: number;
  /** Per le trattenute: l'aliquota applicata, in percentuale */
  aliquota?: number;
  /** Colonna di provenienza: utile per il debug del parsing */
  colonna?: 'competenze' | 'trattenute' | 'figurati';
  /** true se la voce è stata ricostruita dai totali e non letta da una riga */
  sintetica?: boolean;
}

export interface Rateo {
  residuoAnnoPrec: number;
  maturato: number;
  goduto: number;
  saldo: number;
}

export interface Totali {
  competenze: number;
  trattenute: number;
  netto: number;
  trattenutePrevFisc?: number;
  arrotondamentoPrecedente?: number;
  arrotondamentoAttuale?: number;
  imponibileFiscale?: number;
  irpefLorda?: number;
  detrazioni?: number;
  irpefNetta?: number;
}

export interface Progressivi {
  imponibileFiscale?: number;
  impostaLorda?: number;
  detrazioni?: number;
  impostaDovuta?: number;
  impostaPagata?: number;
}

export interface Presenze {
  oreLavorate?: number;
  giorniLavorati?: number;
  oreRetribuite?: number;
  giorniRetribuiti?: number;
  oreStraordinario?: number;
  giorniInps?: number;
  settimaneInps?: number;
}

export interface Cedolino {
  /** Identificativo del parser che ha prodotto il dato */
  formato: string;

  dipendente: {
    nome: string;
    codiceFiscale: string;
    matricola?: string;
    qualifica?: string;
    livello?: string;
    dataNascita?: string;
    dataAssunzione?: string;
    dataCessazione?: string;
  };

  azienda: {
    nome: string;
    /** Nei contratti in somministrazione: l'azienda dove lavori davvero */
    utilizzatrice?: string;
  };

  periodo: {
    /** 1-12, se riconosciuto */
    mese?: number;
    anno?: number;
    /** Etichetta leggibile, es. "Agosto 2026" */
    label: string;
  };

  competenze: VoceImporto[];
  trattenute: VoceImporto[];
  /** Voci figurative: non pagate in busta (ticket, TFR accantonato...) */
  figurativi: VoceImporto[];

  totali: Totali;
  progressivi: Progressivi;
  presenze: Presenze;

  ratei: {
    ferie?: Rateo;
    rol?: Rateo;
    exFestivita?: Rateo;
    bancaOre?: Rateo;
  };

  /** Paga oraria complessiva (base + contingenza + EDR + terzo elemento) */
  pagaOraria?: number;
  tfrMese?: number;
  iban?: string;

  /**
   * Problemi rilevati durante il parsing o la validazione.
   * Se non è vuoto, il riepilogo NON va considerato affidabile.
   */
  anomalie: string[];
}

export function cedolinoVuoto(formato: string): Cedolino {
  return {
    formato,
    dipendente: { nome: '', codiceFiscale: '' },
    azienda: { nome: '' },
    periodo: { label: '' },
    competenze: [],
    trattenute: [],
    figurativi: [],
    totali: { competenze: 0, trattenute: 0, netto: 0 },
    progressivi: {},
    presenze: {},
    ratei: {},
    anomalie: [],
  };
}
