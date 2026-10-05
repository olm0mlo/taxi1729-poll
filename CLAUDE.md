# Come lavorare su Taxi1729 Poll

Istruzioni per Claude. Valgono per ogni sessione di lavoro su questo progetto.

## Chi sono e come comunicare
- Ho basi di programmazione, non sono uno sviluppatore. Spiegami le cose in italiano, con parole semplici e senza gergo tecnico;
  se un termine tecnico serve, spiegalo in una frase.
- Voglio essere autonomo nell'uso del programma: quando mi chiedi di fare qualcosa (su GitHub, Cloudflare, PowerPoint)
  dammi i passaggi uno per uno, dicendo esattamente dove cliccare.
- Quando mostri un risultato grafico, mandami uno screenshot.

## Regola principale: avvisami prima se una richiesta pesa troppo
Prima di scrivere codice, valuta ogni mia richiesta e dimmi se rientra in uno di questi casi:

**Appesantisce il programma**
- rende più lento o più pesante l'add-in in PowerPoint (più cose da caricare, più calcoli mentre si proietta,
  animazioni pesanti, librerie esterne);
- aumenta molto il lavoro del server durante un evento con 500–1000 persone collegate
  (più messaggi verso tutti i telefoni, calcoli ripetuti a ogni voto);
- rischia di avvicinarsi ai limiti dei piani gratuiti di Cloudflare o GitHub.

**Complica l'infrastruttura**
- aggiunge un nuovo servizio, account, abbonamento o fornitore esterno;
- cambia come è fatto il sistema (un secondo server o database, un nuovo modo di fare login, domini, ecc.);
- richiede di reinstallare l'add-in su tutti i computer o di cambiare il modo in cui è distribuito;
- funziona solo su Windows o solo su Mac;
- aggiunge molto codice da mantenere, o una dipendenza (libreria/pacchetto) nuova.

**È rischiosa**
- tocca i dati già salvati (eventi, domande, voti) o il modo in cui vengono conservati;
- potrebbe far perdere o raddoppiare voti, o rompere le riconnessioni dei telefoni.

In questi casi **non iniziare subito**. Prima dimmi, in poche righe:
1. il peso della richiesta: **leggera**, **media** o **impegnativa**, e perché;
2. che cosa cambierebbe nel concreto (per me, per il pubblico, per i costi);
3. se esiste un'alternativa più leggera che ottiene quasi lo stesso risultato;

poi aspetta la mia conferma. Le richieste leggere puoi farle direttamente.

## Proposte prima del codice
- Se scrivo "fammi proposte", "non programmare" o simili: niente codice. Mostrami 2–3 alternative
  (con immagini di prova quando si tratta di grafica), indica quale consigli e perché, e aspetta che io scelga.
- Se una richiesta è ambigua e rifarla costerebbe tempo, chiedimi prima di partire.

## Pubblicazione ed eventi
- Ogni modifica inviata a GitHub (ramo `main`) viene pubblicata da Cloudflare in automatico e **riavvia il server**:
  tutti i telefoni e le presentazioni collegati si scollegano per qualche secondo.
- Dimmi sempre quando una modifica sta per essere pubblicata e quanto tempo aspettare prima di usarla o testarla.
- Se ti dico che c'è un evento in corso o imminente, non pubblicare nulla senza il mio via libera esplicito.

## Come verificare il lavoro
- Prima di pubblicare, prova le modifiche (pagine nel browser, grafici, telefoni) e controlla di non aver rotto
  quello che già funzionava: grafici esistenti, riconnessioni, conteggio dei voti.
- Per modifiche che toccano server, voti o collegamenti, esegui il test di carico in locale (`loadtest/carico.mjs`)
  e, se serve, chiedimi di lanciarlo sul server vero da GitHub → Actions → "Test di carico".
- Alla fine dimmi in breve cosa è cambiato, cosa hai verificato e cosa resta da provare in PowerPoint.

## Scelte tecniche da mantenere (salvo mio diverso accordo)
- Tutto gira su Cloudflare: un Worker che serve le pagine e un unico Durable Object ("Hub") con database SQLite,
  dati in Unione Europea. GitHub serve solo come archivio del codice e per il test di carico.
- Pagine in HTML/CSS/JavaScript semplice, senza framework e senza passaggi di compilazione.
- Niente nuove librerie o servizi esterni senza avermelo chiesto prima.
- L'add-in deve funzionare su PowerPoint per Windows e per Mac (Microsoft 365).
- Commenti e testi visibili nel programma in italiano.
