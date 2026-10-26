# Taxi1729 Poll — passaggio di consegne

Documento per riprendere il lavoro in una nuova sessione (o con un altro account Claude) senza perdere il contesto.
Aggiornato al 26 ottobre 2026. Chi riprende il lavoro: leggi prima `CLAUDE.md` (regole di lavoro), poi questo file.

---

## 1. Cos'è e a che punto siamo

Sistema di sondaggi dal vivo per gli eventi di divulgazione scientifica Taxi1729, integrato in PowerPoint (Windows e Mac,
Microsoft 365). Il pubblico (500–1000 persone) inquadra un QR code e vota dal telefono, senza app né registrazione; i
risultati compaiono in tempo reale nella slide con la grafica Taxi1729. Lo usano 3 persone dello staff (nessun limite
tecnico al numero di utenti; tutti hanno gli stessi permessi).

**Stato:** in uso, funzionante. Test di carico con 1000 telefoni simulati superato sul server vero (30 settembre 2026).
Sviluppo iniziato il 30 settembre 2026; ultima modifica il 21 ottobre 2026.

## 2. Indirizzi, account e impostazioni

| Cosa | Dove |
|---|---|
| Sito / pubblico | https://taxi1729-poll.olmovit.workers.dev (QR → `/?e=CODICE`) |
| Pannello amministratore | https://taxi1729-poll.olmovit.workers.dev/admin |
| Presentazione da browser | `/present?event=ID` (dal pannello: "Presenta nel browser") |
| Add-in PowerPoint | `/addin` — manifest scaricabile dal pannello, sezione "Installa add-in" |
| Codice | GitHub `olm0mlo/taxi1729-poll`, ramo `main` |
| Server | Cloudflare (account dell'utente, sottodominio `olmovit`), Worker `taxi1729-poll` |

- **Pubblicazione automatica:** Cloudflare Workers Builds è collegato al repository. Ogni push su `main` viene pubblicato in
  1–2 minuti (root directory `app`, build command vuoto, deploy command `npx wrangler deploy`).
  **Ogni pubblicazione riavvia il server**: telefoni e presentazioni si scollegano per qualche secondo e si ricollegano da soli.
  Mai pubblicare durante un evento.
- **Secrets GitHub** (per il test di carico): `T1729_EMAIL`, `T1729_PASSWORD` = utente "Test di carico" creato nel pannello.
- **Installazione add-in:** Windows = cartella condivisa (catalogo attendibile); Mac = file `taxi1729-poll.xml` in
  `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef`. Istruzioni anche nel pannello.
  Microsoft non consente pulsanti nella barra per i "content add-in": si inserisce da Home › Componenti aggiuntivi, oppure
  si duplicano slide già pronte (consigliato: tenere una presentazione modello).
- **Piano Cloudflare gratuito:** 100.000 richieste/giorno, 100.000 righe scritte/giorno, 5 M righe lette/giorno, 5 GB
  (reset a mezzanotte UTC). Pagine statiche gratuite e illimitate. Stima: evento da 1000 persone ≈ 20.000 richieste.
  Messaggi WebSocket in entrata contati 20:1. Verifica consumi: Cloudflare → Workers & Pages → taxi1729-poll → Metrics.

## 3. Architettura

```
Telefoni (index.html) ─┐
Add-in PowerPoint ─────┼─ HTTPS (/api) + WebSocket (/ws) ─▶ Worker ─▶ Durable Object "Hub" (UE)
Pannello (admin.html) ─┘                                              SQLite: utenti, sessioni, eventi,
                                                                      domande, voti, gruppi, live
```

- **Un solo Durable Object** (`Hub`, `idFromName("main")`, giurisdizione `eu`) per tutta l'app: dati (SQLite integrato)
  e collegamenti in tempo reale (WebSocket Hibernation API, tag `a:<eventId>` pubblico, `p:<eventId>` presentatori/pannello).
- **Niente framework, niente compilazione**: HTML/CSS/JS semplice (vincolo voluto dall'utente). Librerie esterne: solo
  qrcode.js da cdnjs e i font Google Inter/Raleway.
- **L'add-in è una pagina web** dentro la slide: un'istanza per slide; le impostazioni di ogni slide stanno nel `.pptx`
  (`Office.context.document.settings`). Aggiornare il codice non richiede di reinstallare l'add-in.

### File

| File | Contenuto |
|---|---|
| `app/src/worker.js` | Server: API, autenticazione, voti, risultati, istogrammi, gruppi, simulazione, export CSV, tempo reale |
| `app/public/index.html` | Pagina del pubblico (voto, stima numerica, schermate di attesa/fine) |
| `app/public/admin.html` | Pannello: eventi, domande, risultati, simulazione, utenti, installazione add-in |
| `app/public/addin.html` | Add-in PowerPoint: impostazioni per slide, rilevamento slide in proiezione, proiezione |
| `app/public/present.html` | Presentazione da browser (tasti: frecce, R, G, A, Q, S, F) |
| `app/public/shared/slide.js` + `slide.css` | Disegno della slide su tela fissa 1920×1080 e tutti i grafici |
| `app/public/shared/editor.js` | Editor delle domande (pannello e add-in) |
| `app/public/shared/api.js` | Chiamate al server, WebSocket con riconnessione, `T.parseNum` / `T.fmtNum` |
| `loadtest/carico.mjs` | Test di carico (1000 telefoni) — `.github/workflows/test-di-carico.yml` |
| `CLAUDE.md` | Regole di lavoro con l'utente |

### Protocollo in tempo reale (WebSocket `/ws`)

- Presentatore (`role=presenter&event=ID&token=…`): invia `show {q, k, force, fresh}` ogni 2 s mentre la slide è in
  proiezione (`q` = domanda o `null`, `k` = chiave della slide, `fresh` = primo annuncio dopo che la slide è diventata
  attiva o dopo una riconnessione), `hide {q, k}` quando la slide smette di essere attiva, `leave` all'uscita dalla
  proiezione (libera subito il blocco per i colleghi), `reveal {q, on}`, `watch {q}` o `watch {qs:[…]}` (riepilogo),
  `stop`. Riceve `live`, `results`, `locked`, `error`.
- Conflitti: se due slide dello stesso presentatore si credono in proiezione (es. slide duplicata), vince l'ultima che ha
  mandato `fresh`; gli annunci dell'altra con una domanda diversa sono ignorati finché la vincente manda segnali
  (ogni connessione presentatore ha un `sid`).
- Pubblico (`role=audience&code=…&voter=…`, voter = id casuale salvato nel browser): riceve `hello`, `state {q, voted,
  idle, closed}`, `voted`, `error`; invia `vote {q, choices}` o `vote {q, value}`.
- Entrambi: `ping` → `pong` (25 s pubblico, 3 s presentatore; senza risposta in 8/3 s la connessione si riapre).

### Tempi (costanti in `worker.js`)

| Costante | Valore | Significato |
|---|---|---|
| `STALE_MS` | 8 s | senza segnali dalla slide la domanda si chiude per il pubblico |
| `HIDE_GRACE_MS` | 2,5 s | attesa prima di chiudere una domanda quando la sua slide si chiude (evita lampeggi tra slide della stessa domanda) |
| `IDLE_MS` | 3 min | nessuna slide in proiezione → telefoni su "La presentazione non è in corso" |
| `PRESENTING_MS` | 30 s | "In presentazione da …" nel pannello solo se l'ultimo segnale è recente |
| `LOCK_MS` | 10 min | blocco: un altro utente non può presentare lo stesso evento senza "Prendi il controllo" |
| Risultati | ogni 0,3 s | invio dei totali aggiornati alle slide |

## 4. Funzioni presenti

**Tipi di domanda**
- **Scelta multipla** (2–12 risposte, singola o multipla). Grafici: barre orizzontali, barre verticali, ciambella ("Torta"),
  dot cluster. Segmentazione facoltativa per le risposte a una domanda precedente a risposta singola.
- **Crowd Wisdom** (stima numerica): numero libero (virgola decimale, punto delle migliaia), interi/decimali, min/max,
  unità, messaggio di errore; istogramma classico con mediana/media/nessuna linea; risposta esatta facoltativa (linea gialla,
  solo nelle slide dove si sceglie "Visibile", tasto A nel browser); colonne automatiche o fisse con colonne
  "sotto…/oltre…"; per slide "Mostra domanda" / "Mostra risultati" (tasto Q). Domanda non scritta sulla slide salvo opzione.
- **Due versioni della stessa domanda** (es. effetto ancoraggio): metà pubblico legge la versione A, metà la B
  (assegnazione bilanciata, stabile alle riconnessioni, tabella `groups`); sullo schermo un titolo neutro; risultati divisi
  per gruppo. Una Crowd Wisdom successiva può essere "Separata per gruppi": due istogrammi con stessa scala oppure
  (per slide) solo le due mediane/medie in grande (tasto G).

**Slide nell'add-in:** Domanda, Benvenuto (solo QR), Riepilogo di due domande (due ciambelle affiancate, telefoni in
attesa). Per slide si sceglie: grafico, risultati nascosti/visibili, risposta esatta, mostra domanda/risultati, vista gruppi.
Per mostrare i risultati "su click" si **duplica la slide** e nella copia si sceglie "Visibili" (cliccare dentro il
riquadro non è possibile in proiezione: blocca i tasti di PowerPoint).

**Telefono:** "Tieni d'occhio / lo schermo" (presentazione in corso, nessuna domanda); "La presentazione / non è in corso"
(nessuna proiezione da 3 min o mai avviata); "L'evento è concluso – Grazie per aver partecipato" (evento chiuso dal
pannello con "Chiudi evento", reversibile con "Riapri evento"; non si vota). Un voto perso durante una caduta di rete
viene rispedito al ritorno.

**Pannello:** eventi (codice a 5 cifre), domande (crea/modifica/duplica/riordina/svuota/elimina), anteprima risultati,
"Simula voti" (marcati `sim=1`, esclusi dall'export, eliminabili con "Cancella voti simulati"), export CSV per Excel
(totali, per gruppo, statistiche e tutte le stime Crowd Wisdom), utenti, installazione add-in.

## 5. Scelte grafiche e preferenze dell'utente (non cambiare senza chiedere)

- Sfondo blu notte `#02151f`, giallo `#e8ea6e`, palette in `slide.js` (`PALETTE`); percentuali in bianco.
- Sopra il titolo **solo il nome dell'evento**, senza numero della domanda (tolto il 20/10).
- QR piccolo in alto a destra con "codice XXXXX" sotto; totale risposte in basso a sinistra allineato al logo.
- Barre orizzontali sottili; barre verticali senza traccia chiara; ciambella (non torta piena) centrata con legenda a lato;
  torte segmentate "a tabella" (una ciambella per gruppo nel colore del gruppo, sfumature, percentuali sotto); dot cluster
  10 pallini per riga in colonne separate.
- Animazioni: barre/colonne crescono da zero in sequenza (< 1 s), pallini compaiono uno alla volta, ciambella senza
  animazione, numeri che scorrono.
- Crowd Wisdom: istogramma classico con colonne leggermente distanziate; etichette mediana/risposta esatta mai
  sovrapposte ("a bandiera", poi su due righe).
- Gruppi: azzurro `#7fa6ad` (A) e salmone `#f28f86` (B), uguali in tutti i grafici.
- Benvenuto (opzione C, 20/10): QR grande a sinistra, "Inquadra / il QR code" grande a destra con linea gialla,
  "oppure vai su …/?e=CODICE" piccolo in basso a sinistra; testo fisso (campo titolo tolto dall'add-in).
- Riepilogo (opzione A): testo della domanda sopra ogni ciambella, totale al centro, legenda con % sotto, linea divisoria.
- Il pubblico usa **sempre la rete dati del telefono**, mai il Wi-Fi della sala. Il computer di proiezione deve avere
  internet (cavo o hotspot/router 4G dedicato).

## 6. Come si verifica il lavoro

- **Test di carico sul server vero:** GitHub → Actions → "Test di carico" → Run workflow (indirizzo del sito, 1000, 20).
  Crea un evento temporaneo, simula voti/cadute/riavvii, controlla i conteggi, cancella tutto. Risultato nella pagina
  Summary. Non lanciarlo subito dopo una pubblicazione (il server si riavvia) né il giorno di un evento grande.
- **Prove in locale (da ricreare):** nelle sessioni precedenti si usava uno script Node che carica `worker.js` con un
  finto Durable Object (SQLite di Node `node:sqlite`, WebSocket reali), Playwright per fotografare slide/telefoni/pannello
  e uno "stub" di Office.js per provare l'add-in nel browser. Questi script **non sono nel repository**: vanno ricreati
  se servono (Playwright e Chromium sono preinstallati nell'ambiente; npm per wrangler era bloccato).
- Prima di pubblicare: provare le modifiche e ricontrollare grafici esistenti, riconnessioni e conteggio dei voti.

## 7. Problemi noti (revisione del codice del 23/10)

**Corretti il 26/10** (punti 1, 2, 3 qui sotto): rilevamento slide che non accende più tutte le istanze dopo un errore
passeggero (si attende fino a 10 s), ricontrollo della slide all'avvio in Modifica (le copie si correggono da sole) più
risoluzione dei conflitti nel server, `hide` + `leave` all'uscita dalla proiezione. Verificati con un Office.js finto.

Da fare:
1. ~~ **Errore passeggero di rilevamento slide** (`addin.html`, `evaluate`): se `getSelectedDataAsync` fallisce una volta,
   il ripiego "visibilità" può attivare tutte le istanze caricate → la domanda sui telefoni cambia per un attimo.
   Correzione: se `S.slideId` è noto e il rilevamento fallisce, mantenere lo stato.~~ (corretto)
2. ~~**Slide duplicate**: la copia eredita lo `slideId` dell'originale e si corregge solo con un clic nel riquadro in
   modalità Modifica. Ha causato lo sfarfallio del 20/10 (riepilogo duplicato da una slide domanda). Correzione:
   `detectMySlide(true)` sempre all'avvio in modalità Modifica; in più (proposta) il server potrebbe ignorare gli annunci
   di una slide che non è l'ultima diventata attiva.~~ (corretto)
3. ~~**Uscita dalla proiezione senza `hide`** (`onView`: `ensureConn` chiude la connessione prima di `setActive(false)`).~~ (corretto)
4. **Barre orizzontali con ≥10 risposte** escono dallo spazio (si sovrappongono a codice e totale).
5. **Cambio di tipo di una domanda con voti** (scelta multipla ↔ stima) reinterpreta i voti; se era base di segmentazione
   i risultati dell'altra domanda vanno in errore 500. Proposta: impedire il cambio di tipo se ci sono voti.

Altri: `T.parseNum("0.125")` = 125; tastiera iPhone senza segno meno; voti illimitati con id inventati (abuso del
limite scritture: limitare per IP con `CF-Connecting-IP`); etichette lunghe nella ciambella non accorciate; anteprime
`T.Slide` mai liberate (timer e listener); ping dei telefoni = voce di consumo principale (`ctx.setWebSocketAutoResponse`);
token nell'URL dell'export CSV; blocco login per email sfruttabile; dopo "Svuota" i telefoni non possono rivotare senza
ricaricare; domanda cancellata in proiezione → voti in errore; codice evento vuoto → nuovo codice casuale; duplicazioni
(messaggio "Inserisci un numero…" in 3 file); residui (`S.welcomeTitle`, `.t-wcode`, `t-join`, commento doppio riga 12
di `worker.js`).

## 8. Da fare / idee

- Correggere i punti 4–5 della sezione 7 e il problema delle anteprime (in attesa del via dell'utente).
- Dominio dedicato **poll.taxi1729.it** (indirizzo più corto sul QR e sulla slide di benvenuto).
- Domanda di tipo **Rating** (scala con istogramma e media; commenti solo nei risultati).
- Accesso con **account Microsoft**.
- Più avanti: quiz/gare con punteggi. Q&A (domande del pubblico) escluso.
- Proposte non fatte: pulsante nella barra di PowerPoint (richiede un secondo add-in e distribuzione centralizzata
  Microsoft 365); "lista salvata" nell'add-in (scartata per rischio di conflitti); presentazione modello `.pptx`.

## 9. Come lavorare con l'utente (sintesi)

- Non è uno sviluppatore: italiano semplice, niente gergo, passaggi uno per uno con dove cliccare, screenshot dei risultati grafici.
- **Non iniziare a programmare senza un suo via libera esplicito** ("procedi", "fallo"); prima valutare sinceramente se la
  richiesta è sensata, quanto pesa (leggera/media/impegnativa), se appesantisce o complica l'infrastruttura, e proporre
  alternative più leggere. Se chiede "proposte" o "senza programmare": immagini di prova e 2–3 opzioni, niente codice.
- Avvisare prima di ogni pubblicazione e dire quanto aspettare; mai pubblicare durante un evento.
