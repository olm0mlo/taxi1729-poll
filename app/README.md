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
