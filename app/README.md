# Taxi1729 Poll — applicazione

Versione definitiva (in costruzione) di Taxi1729 Poll, pubblicata su Cloudflare.

## Struttura
- `wrangler.jsonc` — configurazione Cloudflare
- `src/worker.js` — server: login, eventi, domande, voti, tempo reale (Durable Object "Hub" con database SQLite, dati in UE)
- `public/` — pagine web servite da Cloudflare
  - `index.html` — pagina del pubblico (aperta dal QR code: `/?e=CODICE`)
  - `admin.html` — pannello (`/admin`): eventi, domande, risultati, utenti, installazione add-in
  - `present.html` — presentazione da browser (`/present?event=ID`)
  - `addin.html` — add-in PowerPoint (`/addin`)
  - `shared/` — componenti comuni: grafica della slide e grafici, editor delle domande, accesso al server

## Pubblicazione
Cloudflare (Workers Builds) è collegato al repository GitHub e pubblica automaticamente
ogni modifica sul ramo `main`. Impostazioni del progetto Cloudflare:
- Root directory: `app`
- Build command: *(vuoto)*
- Deploy command: `npx wrangler deploy`

Al primo avvio, aprendo `/admin` si crea il primo utente.

## Tipi di domanda
- **Scelta multipla** — grafici: barre orizzontali, barre verticali, torta, dot cluster; segmentazione facoltativa.
- **Crowd Wisdom** — il pubblico scrive una stima numerica (interi o decimali, minimo/massimo, unità di misura,
  messaggio di errore personalizzabile). Risultato: istogramma con linea della mediana o della media e, se indicata,
  la risposta esatta (gialla), visibile solo nelle slide in cui la si sceglie (add-in) o con il tasto **A** (browser).
  Le colonne sono automatiche o fissate a mano; le stime fuori scala finiscono nelle colonne "sotto…"/"oltre…".
  Ogni slide può mostrare la sola domanda ("Mostra domanda") o i risultati ("Mostra risultati"); nel browser tasto **Q**.
  L'esportazione CSV riporta mediana, media, minimo, massimo e tutte le stime.
- **Due versioni della stessa domanda** (es. esperimento sull'effetto ancoraggio) — metà del pubblico legge la prima
  versione, metà la seconda (assegnazione alternata, stabile anche se il telefono si ricollega); sullo schermo compare
  un titolo neutro. Una domanda Crowd Wisdom successiva può essere "separata per gruppi": due istogrammi con la stessa
  scala oppure, per lo svelamento, solo le due mediane/medie in grande (add-in: "Gruppi in questa slide"; browser: tasto **G**).

## Test di carico
`loadtest/carico.mjs` simula 1000 telefoni (voti, cadute di rete, riconnessione di massa, caduta della presentazione)
e controlla che nessun voto vada perso o venga contato due volte. Si lancia da GitHub → Actions → "Test di carico"
(servono i secrets `T1729_EMAIL` e `T1729_PASSWORD`). Crea un evento temporaneo e lo cancella alla fine.
