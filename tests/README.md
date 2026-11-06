# Prove automatiche

Prove che girano sul computer (o nell'ambiente di Claude), senza toccare il server vero né i dati reali.
Servono Node 22 o successivo e Playwright con Chromium (`npm i -D playwright` e `npx playwright install chromium`,
se non sono già installati). La prova `voti.mjs` non usa il browser e non ha bisogno di Playwright.

## Come si lanciano

Dalla cartella principale del progetto:

```
node tests/tutte.mjs                  # tutte le prove (circa 2 minuti), riepilogo finale
node tests/tutte.mjs voti telefoni    # solo alcune
node tests/voti.mjs                   # una sola
```

Ogni riga dice:
- `OK` — la verifica è passata;
- `ERRORE` — qualcosa che funzionava non funziona più: la prova termina con errore, **non pubblicare**;
- `NOTO` — problema già conosciuto (sezione 7 di `docs/PASSAGGIO-DI-CONSEGNE.md`): segnalato ma non blocca;
- `RISOLTO` — un problema noto non c'è più: trasformare quella riga in una verifica normale (`R.ok`).

Fotografie e file temporanei finiscono in `tests/.tmp/` (non salvata su GitHub): `telefono-*.png` e `grafico-*.png`.
Il QR nelle foto dei grafici è un riquadro grigio, perché il generatore vero si scarica da internet.

## Le prove

| File | Cosa controlla | Durata |
|---|---|---|
| `voti.mjs` | Conteggio dei voti sul codice vero del server: un voto per telefono, doppioni, scelta singola/multipla, stime Crowd Wisdom, due versioni (50/50 stabile), segmentazione, 300 telefoni insieme, riavvio e risveglio del server, voti simulati, Svuota, export CSV, evento concluso | 5 s |
| `telefoni.mjs` | Pagina vera del pubblico in un browser da telefono: tutte le schermate, voto, ricarica, voto perso durante una caduta di rete (rispedito una volta sola), 10 telefoni che si ricollegano dopo un riavvio, stima scritta all'italiana, codice sbagliato | 15 s |
| `grafici.mjs` | Ogni grafico (barre, colonne, ciambella, pallini, segmentati, due versioni, istogramma, gruppi, benvenuto, riepilogo) con risultati veri: numeri giusti sullo schermo e niente fuori posto (fuori dalla slide o sopra QR, codice, totale, logo) | 70 s |
| `proiezione.mjs` | Add-in in proiezione: slide duplicate, errori di rilevamento, uscita dalla proiezione, blocco tra colleghi | 20 s |
| `anteprime.mjs` | Le anteprime di add-in e pannello non si accumulano e restano aggiornate | 15 s |

## File di supporto

| File | A cosa serve |
|---|---|
| `harness.mjs` | Fa girare il codice vero del server (`app/src/worker.js`) con un database in memoria; `H.restart()` simula un riavvio |
| `devserver.mjs` | Server di prova completo: pagine vere di `app/public` + API + tempo reale; `H.dropLinks()` simula una caduta di rete, `H.perdi` fa perdere un messaggio |
| `officestub.js` | PowerPoint finto, per provare l'add-in nel browser (vista, slide selezionata, errori di rilevamento) |
| `strumenti.mjs` | Resoconto OK/ERRORE/NOTO, chiamate alle API, preparazione di utente ed evento |
| `util.mjs` | Trova Playwright e i percorsi di questa cartella |
| `tutte.mjs` | Lancia tutte le prove e stampa il riepilogo |

## Quando lanciarle

Prima di ogni pubblicazione, tutte. Per modifiche che toccano server, voti o collegamenti, anche il test di carico:
`loadtest/carico.mjs` in locale; sul server vero da GitHub → Actions → "Test di carico".
Per una nuova funzione, aggiungere le sue verifiche alla prova dell'argomento (o una prova nuova in `tutte.mjs`).
