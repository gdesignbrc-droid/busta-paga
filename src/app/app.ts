import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { SafeResourceUrl } from '@angular/platform-browser';
import type { Cedolino } from './core/cedolino.model';
import { CedolinoService } from './core/cedolino.service';
import { FormatoNonSupportatoError } from './core/parsers/cedolino-parser';
import { linkSegnalazione as costruisciLinkSegnalazione } from './config';

type Stato = 'attesa' | 'elaborazione' | 'pronto' | 'errore';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <header>
        <h1>Riepilogo busta paga</h1>
        <p>
          Carica il cedolino in PDF e ottieni un riassunto a schede: lordo, trattenute, netto,
          ferie e TFR. Il file resta sul tuo computer: nessun dato viene inviato in rete.
        </p>
      </header>

      @if (stato() !== 'pronto') {
        <label
          class="zona"
          [class.sopra]="trascinamento()"
          (dragover)="onDragOver($event)"
          (dragleave)="trascinamento.set(false)"
          (drop)="onDrop($event)"
        >
          <input type="file" accept="application/pdf,.pdf" (change)="onFile($event)" hidden />
          @if (stato() === 'elaborazione') {
            <strong>Sto leggendo il cedolino…</strong>
          } @else {
            <strong>Trascina qui il cedolino, oppure fai clic per scegliere il file</strong>
            <span>Solo PDF originali scaricati dal portale paghe (non scansioni)</span>
          }
        </label>
      }

      @if (stato() === 'errore') {
        <div class="avviso errore">
          <strong>Non ce l'ho fatta.</strong>
          <p>{{ errore() }}</p>
          @if (anteprima().length > 0) {
            <details>
              <summary>Testo estratto dal PDF ({{ anteprima().length }} righe)</summary>
              <pre>{{ anteprima().join('\n') }}</pre>
              <div class="azioni">
                <button type="button" (click)="copiaAnteprima()">
                  {{ copiato() ? 'Copiato' : 'Copia il testo estratto' }}
                </button>
                @if (linkSegnalazione(); as link) {
                  <a [href]="link">Segnala questo formato</a>
                }
              </div>
              @if (linkSegnalazione()) {
                <p class="minuta">
                  La segnalazione apre il tuo programma di posta con il solo testo qui sopra.
                  Il PDF non viene allegato, ma il testo contiene il tuo nome e i tuoi importi:
                  inviala solo se ti sta bene.
                </p>
              }
            </details>
          }
        </div>
      }

      @if (stato() === 'pronto' && cedolino(); as c) {
        <section class="esito">
          <div class="intestazione">
            <div>
              <h2>{{ c.periodo.label }}</h2>
              <p>{{ c.dipendente.nome }} — {{ c.formato }}</p>
            </div>
            <div class="azioni">
              <a class="primario" [href]="urlPdf()" [download]="nomeFile()">Scarica il PDF</a>
              <!-- Su telefono l'anteprima incorporata non si vede: serve un modo
                   esplicito di aprire il PDF nel visualizzatore del sistema. -->
              <a class="solo-mobile" [href]="urlPdf()" target="_blank" rel="noopener">
                Apri il riepilogo
              </a>
              <button type="button" (click)="ricomincia()">Carica un altro cedolino</button>
            </div>
          </div>

          @if (c.anomalie.length > 0) {
            <div class="avviso attenzione">
              <strong>Da verificare sul cedolino originale:</strong>
              <ul>
                @for (anomalia of c.anomalie; track anomalia) {
                  <li>{{ anomalia }}</li>
                }
              </ul>
            </div>
          } @else {
            <p class="quadra">
              I conti quadrano: lordo meno trattenute corrisponde al netto, e le singole voci
              sommano ai totali stampati sul cedolino.
            </p>
          }

          <iframe [src]="anteprimaPdf()" title="Anteprima del riepilogo"></iframe>
        </section>
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      color-scheme: light;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      color: #17324d;
      background: #f7f9fb;
      min-height: 100vh;
    }
    main {
      max-width: 860px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 1.6rem;
    }
    header p {
      margin: 0 0 24px;
      color: #5b6f82;
      line-height: 1.5;
    }
    .zona {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 48px 24px;
      border: 2px dashed #b9c6d2;
      border-radius: 12px;
      background: #fff;
      cursor: pointer;
      text-align: center;
    }
    .zona.sopra {
      border-color: #ff5b2e;
      background: #fff6f2;
    }
    .zona span {
      color: #5b6f82;
      font-size: 0.875rem;
    }
    .avviso {
      margin-top: 20px;
      padding: 14px 16px;
      border-radius: 8px;
      border-left: 4px solid;
      line-height: 1.5;
    }
    .avviso p,
    .avviso ul {
      margin: 6px 0 0;
    }
    .errore {
      background: #fdf0f0;
      border-color: #c62828;
    }
    .attenzione {
      background: #fff8e6;
      border-color: #e0a800;
    }
    .quadra {
      margin: 16px 0 0;
      color: #22a06b;
      line-height: 1.5;
    }
    .esito .intestazione {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      justify-content: space-between;
      align-items: flex-end;
    }
    .esito h2 {
      margin: 0;
    }
    .esito .intestazione p {
      margin: 4px 0 0;
      color: #5b6f82;
    }
    .azioni {
      display: flex;
      gap: 10px;
    }
    a.primario,
    button {
      font: inherit;
      padding: 9px 16px;
      border-radius: 6px;
      border: 1px solid #0b5ed7;
      background: #fff;
      color: #0b5ed7;
      cursor: pointer;
      text-decoration: none;
    }
    a.primario {
      background: #0b5ed7;
      color: #fff;
    }
    details {
      margin-top: 10px;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
    }
    pre {
      max-height: 260px;
      overflow: auto;
      padding: 10px;
      border-radius: 6px;
      background: #fff;
      border: 1px solid #e6c4c4;
      font-size: 0.78rem;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    iframe {
      width: 100%;
      height: 780px;
      margin-top: 20px;
      border: 1px solid #dfe4e9;
      border-radius: 8px;
      background: #fff;
    }
    .minuta {
      margin: 10px 0 0;
      font-size: 0.8rem;
      color: #5b6f82;
      line-height: 1.5;
    }
    /* Il pulsante "Apri" serve solo dove l'anteprima non si vede. */
    .solo-mobile {
      display: none;
    }

    @media (max-width: 760px) {
      main {
        padding: 20px 14px 48px;
      }
      h1 {
        font-size: 1.35rem;
      }
      .zona {
        padding: 32px 16px;
      }
      /* Safari su iPhone non mostra i PDF dentro un iframe: al suo posto si usa
         il pulsante che apre il file nel visualizzatore del sistema. */
      iframe {
        display: none;
      }
      .solo-mobile {
        display: inline-block;
      }
      .azioni {
        width: 100%;
        flex-wrap: wrap;
      }
      .azioni > * {
        flex: 1 1 auto;
        text-align: center;
        /* Area toccabile comoda anche con il pollice. */
        padding: 13px 16px;
      }
      .esito .intestazione {
        align-items: flex-start;
      }
    }
  `,
})
export class App {
  private readonly servizio = inject(CedolinoService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly stato = signal<Stato>('attesa');
  readonly errore = signal('');
  /** Testo estratto dal PDF, mostrato quando nessun parser lo riconosce. */
  readonly anteprima = signal<string[]>([]);
  readonly copiato = signal(false);
  readonly cedolino = signal<Cedolino | null>(null);
  readonly urlPdf = signal<string | null>(null);
  readonly trascinamento = signal(false);

  readonly anteprimaPdf = computed<SafeResourceUrl | null>(() => {
    const url = this.urlPdf();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  /** Link per segnalare un formato non letto, se è configurato un destinatario. */
  readonly linkSegnalazione = computed(() => costruisciLinkSegnalazione(this.anteprima()));

  readonly nomeFile = computed(() => {
    const c = this.cedolino();
    const periodo = c?.periodo.label.replace(/\s+/g, '_') ?? 'cedolino';
    return `Riepilogo_busta_paga_${periodo}.pdf`;
  });

  onDragOver(evento: DragEvent): void {
    evento.preventDefault();
    this.trascinamento.set(true);
  }

  onDrop(evento: DragEvent): void {
    evento.preventDefault();
    this.trascinamento.set(false);
    const file = evento.dataTransfer?.files?.[0];
    if (file) void this.elabora(file);
  }

  onFile(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.elabora(file);
    input.value = '';
  }

  ricomincia(): void {
    this.liberaUrl();
    this.cedolino.set(null);
    this.stato.set('attesa');
  }

  private async elabora(file: File): Promise<void> {
    if (file.type && file.type !== 'application/pdf') {
      this.stato.set('errore');
      this.errore.set('Il file non è un PDF.');
      return;
    }
    this.stato.set('elaborazione');
    this.errore.set('');
    this.anteprima.set([]);
    this.copiato.set(false);
    try {
      const risultato = await this.servizio.elabora(file);
      this.liberaUrl();
      this.cedolino.set(risultato.cedolino);
      this.urlPdf.set(URL.createObjectURL(risultato.pdf));
      this.stato.set('pronto');
    } catch (e) {
      this.stato.set('errore');
      this.errore.set(e instanceof Error ? e.message : 'Errore imprevisto nella lettura del PDF.');
      if (e instanceof FormatoNonSupportatoError) this.anteprima.set(e.anteprima);
    }
  }

  async copiaAnteprima(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.anteprima().join('\n'));
      this.copiato.set(true);
    } catch {
      this.copiato.set(false);
    }
  }

  private liberaUrl(): void {
    const url = this.urlPdf();
    if (url) URL.revokeObjectURL(url);
    this.urlPdf.set(null);
  }
}
