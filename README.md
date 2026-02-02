# 🎰 SuperEnalotto Sestine

Generatore, gestore e validatore di **sestine SuperEnalotto** completamente **frontend-only**, con focus su **unicità globale**, **performance**, **statistiche** e **trasparenza**.

> ⚠️ Questo strumento **non aumenta le probabilità di vincita**. È pensato per studio, simulazione e intrattenimento.

## ✨ Funzionalità principali

### 🎲 Generazione sestine

- Generazione di **N sestine random** (quantità arbitraria)
- **Unicità globale garantita**: nessuna sestina duplicata (ordine non rilevante)
- Possibilità di:
  - bloccare singole sestine (freeze)
  - rigenerare solo quelle non bloccate

- Generazione **non bloccante** (chunked + yield al browser)

### 🗂️ Gestione gruppi

- Organizza le sestine in **gruppi indipendenti**
- Ogni gruppo ha:
  - nome
  - timeline eventi (generazioni / validazioni)
  - set di sestine dedicato

- Cambio gruppo → ritorno automatico alla schermata _Genera_

### 📊 Statistiche

- Frequenza di uscita dei numeri
- Top 10 numeri più frequenti
- Numeri mai usciti
- Distribuzione teorica della **probabilità di ottenere almeno N match**
- Visualizzazioni ottimizzate e fluide anche con dataset grandi

### ✅ Validatore estrazione

- Inserisci:
  - 6 numeri estratti
  - Jolly (opzionale)
  - SuperStar (opzionale)

- Verifica tutte le sestine del gruppo
- Report dettagliato con:
  - match per sestina
  - evidenziazione numeri colpiti
  - conteggio vincite per categoria
  - **stima € totale vinto** (quote medie)

### 💶 Tabella vincite

Sezione informativa dedicata con:

- Probabilità teoriche SuperEnalotto
- Quote medie attese
- Jackpot configurabile (persistente)

| Numeri | Probabilità      | Quota      |
| ------ | ---------------- | ---------- |
| 6      | 1 su 622.614.630 | Jackpot    |
| 5+1    | 1 su 103.769.105 | ~620.000 € |
| 5      | 1 su 1.250.230   | ~32.000 €  |
| 4      | 1 su 11.907      | ~300 €     |
| 3      | 1 su 327         | ~25 €      |
| 2      | 1 su 22          | ~5 €       |

### ⚙️ Impostazioni avanzate

- **Seed riproducibile**
- Vincoli:
  - numeri esclusi
  - numeri obbligatori
  - almeno uno tra…

- Modalità “superstizione”:
  - numeri fortunati / sfortunati
  - data di nascita → numeri derivati

- Evidenziazioni UI:
  - pari / dispari
  - bassi / alti (≤45 / ≥46)

## 🧠 Scelte tecniche

### Frontend-only

- Nessun backend
- Nessun account
- Nessun tracking
- Tutti i dati sono salvati in **localStorage**

> Ogni utente vede **solo i propri dati**.

### Performance

- Virtualizzazione liste (`react-window`)
- Paginazione
- Scrittura su storage **debounced**
- Generazione a chunk per evitare freeze

Testata con **migliaia di sestine** senza degrado UI.

### UI / UX

- React + TypeScript
- Tailwind CSS
- Design pulito, leggibile, accessibile
- Animazioni leggere (no fronzoli inutili)
- PWA ready (installabile su desktop/mobile)

## 🛠️ Stack

- **React 18**
- **TypeScript**
- **Vite**
- **Tailwind CSS**
- **react-window**
- **vite-plugin-pwa**

## 🚀 Avvio progetto

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## 📱 PWA

L’app è installabile come **Progressive Web App**:

- offline-ready
- persistente
- comportamento simile a un’app nativa

## ⚠️ Disclaimer

Questo progetto:

- **non è affiliato** a Sisal o SuperEnalotto
- **non garantisce vincite**
- usa **quote medie indicative**
- ha scopo **informativo e dimostrativo**

Giocare comporta rischi. Usa responsabilmente.

## 👨‍💻 Autore

**Alessandro Mozzato**

- GitHub: [https://github.com/AleMoz97](https://github.com/AleMoz97)
- LinkedIn: [https://www.linkedin.com/in/alessandro-mozzato-32479420b/](https://www.linkedin.com/in/alessandro-mozzato-32479420b/)
- Email: [alessandromozzato8@gmail.com](mailto:alessandromozzato8@gmail.com)

## 🧪 Idee future (non implementate)

- Export XLSX
- Simulazioni Monte Carlo
- Confronto gruppi
- Dark mode
- API jackpot (serverless)
