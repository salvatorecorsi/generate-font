import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import ttf2woff2 from 'ttf2woff2';

function readGlyphs(inputDirectory) {
  const files = fs.readdirSync(inputDirectory, { withFileTypes: true })
    .filter(file => file.isFile() && path.extname(file.name).toLowerCase() === '.svg')
    .map(file => file.name)
    .sort();

  if (!files.length) throw new Error(`Nessun SVG trovato in ${inputDirectory}.`);

  const names = new Set();

  return files.map(file => {
    const name = path.parse(file).name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    if (!name) throw new Error(`Il file ${file} deve avere un nome con lettere o numeri.`);
    if (names.has(name)) throw new Error(`Nome duplicato dopo la normalizzazione: ${name}.`);
    names.add(name);

    return { name, source: fs.readFileSync(path.join(inputDirectory, file), 'utf8') };
  });
}

function assignCodepoints(glyphs, mappingPath) {
  const codepoints = new Map();
  const occupied = new Set();

  if (fs.existsSync(mappingPath)) {
    const saved = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      throw new Error(`Mappa dei glifi non valida: ${mappingPath}.`);
    }

    for (const [name, codepoint] of Object.entries(saved)) {
      if (!Number.isInteger(codepoint) || codepoint < 0xe000 || codepoint > 0xf8ff || occupied.has(codepoint)) {
        throw new Error(`Codice non valido o duplicato per ${name} in ${mappingPath}.`);
      }

      codepoints.set(name, codepoint);
      occupied.add(codepoint);
    }
  }

  let nextCodepoint = 0xe000;

  for (const glyph of glyphs) {
    if (!codepoints.has(glyph.name)) {
      while (occupied.has(nextCodepoint)) nextCodepoint++;
      if (nextCodepoint > 0xf8ff) throw new Error('Esauriti i 6400 codici Unicode privati disponibili.');
      codepoints.set(glyph.name, nextCodepoint);
      occupied.add(nextCodepoint);
    }

    glyph.codepoint = codepoints.get(glyph.name);
  }

  return Object.fromEntries(codepoints);
}

async function createSvgFont(glyphs, fontName) {
  const fontStream = new SVGIcons2SVGFontStream({
    fontName,
    fontHeight: 1000,
    normalize: true,
    descent: 0,
  });
  const glyphStreams = glyphs.map(glyph => {
    const glyphStream = Readable.from([glyph.source]);
    glyphStream.metadata = {
      name: glyph.name,
      unicode: [String.fromCodePoint(glyph.codepoint)],
    };
    return glyphStream;
  });
  const chunks = [];

  await pipeline(Readable.from(glyphStreams), fontStream, async chunksStream => {
    for await (const chunk of chunksStream) chunks.push(Buffer.from(chunk));
  });

  const svgFont = Buffer.concat(chunks).toString('utf8');
  const emptyGlyph = svgFont.match(/<glyph glyph-name="([^"]+)"[^>]*\sd=""\s*\/>/);
  if (emptyGlyph) throw new Error(`Il glifo ${emptyGlyph[1]} non contiene tracciati pieni. Espandi i tratti prima di esportare.`);

  return svgFont;
}

function createCss(glyphs, fontName) {
  const fontSelectors = glyphs.map(glyph => `.icon-${glyph.name}::before`).join(',\n');
  const selectors = glyphs.map(glyph =>
    `.icon-${glyph.name}::before { content: "\\${glyph.codepoint.toString(16)}"; }`
  );

  return `@font-face {
  font-family: '${fontName}';
  src: url('./${fontName}.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

${fontSelectors} {
  display: inline-block;
  font-family: '${fontName}';
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

${selectors.join('\n')}
`;
}

function createPreview(glyphs, fontName) {
  const cards = glyphs.map(glyph => `    <li><i class="icon-${glyph.name}" aria-hidden="true"></i><code>icon-${glyph.name}</code><small>U+${glyph.codepoint.toString(16).toUpperCase()}</small></li>`);

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${fontName}</title>
  <link rel="stylesheet" href="./${fontName}.css">
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 72rem; margin: auto; padding: 2rem; }
    h1 { margin-bottom: .5rem; }
    p, small { opacity: .65; }
    ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 1rem; padding: 0; list-style: none; }
    li { display: grid; justify-items: center; gap: .75rem; padding: 2rem 1rem; border: 1px solid; border-radius: .25rem; }
    i { font-size: 3rem; }
    code { overflow-wrap: anywhere; text-align: center; }
  </style>
</head>
<body>
  <h1>${fontName}</h1>
  <p>${glyphs.length} glifi · WOFF2 / TTF</p>
  <ul>
${cards.join('\n')}
  </ul>
</body>
</html>
`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: './svg' },
      output: { type: 'string', default: './icons' },
      name: { type: 'string', default: 'icons' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log('Uso: node generate-font.mjs [--input ./svg] [--output ./icons] [--name icons]');
    return;
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,62}$/.test(values.name)) {
    throw new Error('Il nome del font deve iniziare con una lettera e contenere solo lettere, numeri, trattini o underscore (massimo 63 caratteri).');
  }

  const inputDirectory = path.resolve(values.input);
  const outputDirectory = path.resolve(values.output);
  const fontName = values.name;
  const mappingPath = path.join(outputDirectory, `${fontName}.json`);
  const glyphs = readGlyphs(inputDirectory);
  const codepoints = assignCodepoints(glyphs, mappingPath);
  const svgFont = await createSvgFont(glyphs, fontName);
  const ttf = Buffer.from(svg2ttf(svgFont, { ts: 0 }).buffer);
  const woff2 = ttf2woff2(ttf);

  if (woff2.length < 48 || woff2.toString('ascii', 0, 4) !== 'wOF2' || woff2.readUInt32BE(8) !== woff2.length) {
    throw new Error('La conversione non ha prodotto un WOFF2 valido.');
  }

  const outputs = {
    woff2,
    ttf,
    css: createCss(glyphs, fontName),
    html: createPreview(glyphs, fontName),
    json: `${JSON.stringify(codepoints, null, 2)}\n`,
  };

  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [extension, content] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(outputDirectory, `${fontName}.${extension}`), content);
  }

  console.log(`${glyphs.length} glifi generati in ${outputDirectory}: WOFF2, TTF, CSS, anteprima HTML e mappa Unicode.`);
}

main().catch(error => {
  console.error(`Errore: ${error.message}`);
  process.exitCode = 1;
});
