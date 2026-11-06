# Prove automatiche

Prove che girano sul computer (o nell'ambiente di Claude), senza toccare il server vero né i dati reali.
Servono Node 22 o successivo e Playwright con Chromium (`npm i -D playwright` e `npx playwright install chromium`,
se non sono già installati).

| File | A cosa serve |
|---|---|
| `harness.mjs` | Fa girare il codice vero del server (`app/src/worker.js`) con un database in memoria |
| `devserver.mjs` | Server di prova completo: pagine vere di `app/public` + API + tempo reale |
| `officestub.js` | PowerPoint finto, per provare l'add-in nel browser (vista, slide selezionata, errori di rilevamento) |
| `util.mjs` | Trova Playwright e i percorsi di questa cartella |
| `proiezione.mjs` | Slide duplicate, errori di rilevamento, uscita dalla proiezione, blocco tra colleghi |
| `anteprime.mjs` | Le anteprime di add-in e pannello non si accumulano e restano aggiornate |

Uso, dalla cartella principale del progetto:

```
node tests/proiezione.mjs
node tests/anteprime.mjs
```

Ogni prova stampa una riga `OK` o `ERRORE` per controllo e termina con errore se qualcosa non va. Immagini e file
temporanei finiscono in `tests/.tmp/` (non salvata su GitHub).

Test di carico (1000 telefoni): `loadtest/carico.mjs`; sul server vero si lancia da GitHub → Actions → "Test di carico".
