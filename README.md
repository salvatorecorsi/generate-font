# generate-font

Da una cartella di SVG a un font di icone e pittogrammi. Un solo script JavaScript, tre dipendenze, nessun passaggio interattivo.

## Utilizzo

Richiede Node.js **20.11.1 o successivo**.

```sh
npm install
```

Inserisci gli SVG in `./svg`, poi esegui:

```sh
npm start
```

Genera in `./icons` i file `icons.woff2`, `icons.ttf`, `icons.css`, `icons.html` e `icons.json`. Il WOFF2 serve per il web; il TTF è già installabile su desktop. Il formato OTF con contorni CFF richiederebbe una conversione ulteriore e per ora non è previsto.

Per cambiare cartelle e nome del font:

```sh
node generate-font.mjs --input ./svg --output ./icons --name icons
node generate-font.mjs --help
```

Il nome del font deve iniziare con una lettera, contenere solo lettere ASCII, numeri, `_` o `-` e non superare 63 caratteri.

## SVG e nomi

Sono accettate estensioni `.svg` anche maiuscole. Usa SVG monocromatici: espandi gli stroke e converti il testo in tracciati. Maschere, filtri e clipping complessi possono non essere convertiti fedelmente.

Il nome di ogni icona deriva dal nome del file senza estensione: i caratteri non alfanumerici diventano trattini e le maiuscole vengono mantenute. Per esempio, `arrow right.svg` diventa `arrow-right`. Se più file producono lo stesso nome, la generazione si interrompe.

## Nel sito

```html
<link rel="stylesheet" href="icons/icons.css">
<i class="icon-home" aria-hidden="true"></i>
```

Per le icone che comunicano un significato, assegna un'etichetta accessibile al controllo o all'elemento pertinente. Apri `icons/icons.html` per vedere l'anteprima, che carica il WOFF2 generato.

## Codici stabili

`icons.json` associa ogni nome normalizzato al suo codice Unicode numerico. Conservalo e versionalo insieme ai font: mantiene anche le assegnazioni delle icone rimosse, così i loro codici non vengono riutilizzati. Cancellarlo azzera le assegnazioni; con un nome personalizzato il file si chiama `<nome>.json`.

## Verifica

```sh
npm test
```

Esegue i test di integrazione con il test runner incluso in Node.js.
