import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';

import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import ttf2woff2 from 'ttf2woff2';

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Reads all SVG files from the specified directory.
 * @param {string} directory - The directory to read SVG files from.
 * @returns {string[]} - Array of SVG file paths.
 */
const readSVGFiles = (directory) => {
  return fs.readdirSync(directory)
    .filter(file => file.endsWith('.svg'))
    .map(file => path.join(directory, file));
};

/**
 * Calculates an MD5 hash based on the SVG files' names and sizes.
 * @param {string[]} svgFiles - Array of SVG file paths.
 * @returns {string} - The computed hash as a hexadecimal string.
 */
const getSVGFilesHash = (svgFiles) => {
  const hash = crypto.createHash('md5');
  hash.update(svgFiles.length.toString()); // Number of files
  svgFiles.forEach(file => {
    const stats = fs.statSync(file);
    hash.update(file); // File name
    hash.update(stats.size.toString()); // File size
  });
  return hash.digest('hex');
};

/**
 * Sanitizes a glyph name by replacing non-alphanumeric characters with hyphens.
 * @param {string} name - The original glyph name.
 * @returns {string} - The sanitized glyph name.
 */
const sanitizeGlyphName = (name) => {
  return name.replace(/[^a-zA-Z0-9]/g, '-');
};

/**
 * Writes content to a file.
 * @param {string} filePath - The path to the file.
 * @param {Buffer|string} content - The content to write.
 */
const saveFile = (filePath, content) => {
  fs.writeFileSync(filePath, content);
};

/**
 * Generates the font files (SVG, TTF, WOFF2) and corresponding CSS.
 * @param {string[]} svgFiles - Array of SVG file paths.
 * @param {string} fontName - The name of the generated font.
 * @param {string} outputDir - The directory where the output files will be saved.
 */
const generateFont = async (svgFiles, fontName, outputDir) => {
  const fontStream = new SVGIcons2SVGFontStream({
    fontName: fontName,
    fontHeight: 1000,
    normalize: true,
    descent: 0,
  });

  const cssContent = [];
  const svgChunks = [];

  svgFiles.forEach((file, index) => {
    const glyph = fs.createReadStream(file);
    const glyphName = sanitizeGlyphName(path.basename(file, '.svg'));
    const unicode = String.fromCharCode(0xe000 + index); // Private Use Area
    glyph.metadata = {
      unicode: [unicode],
      name: glyphName,
    };
    fontStream.write(glyph);

    // Generate corresponding CSS class
    cssContent.push(`.icon-${glyphName}:before { content: "\\${unicode.charCodeAt(0).toString(16)}"; }`);
  });

  fontStream.end();

  fontStream.on('data', (chunk) => {
    // Ensure the chunk is a Buffer
    if (Buffer.isBuffer(chunk)) {
      svgChunks.push(chunk);
    } else {
      svgChunks.push(Buffer.from(chunk, 'utf8'));
    }
  });

  fontStream.on('finish', () => {
    try {
      const svgFontBuffer = Buffer.concat(svgChunks);

      // Convert SVG to TTF
      const ttf = svg2ttf(svgFontBuffer.toString('utf8'), {});
      const ttfBuffer = Buffer.from(ttf.buffer);

      // Convert TTF to WOFF2
      const woff2 = ttf2woff2(ttfBuffer);
      const woff2Path = path.join(outputDir, `${fontName}.woff2`);
      saveFile(woff2Path, Buffer.from(woff2.buffer));

      // Generate CSS file
      const cssPath = path.join(outputDir, `${fontName}.css`);
      const fontFace = `
@font-face { 
  font-family: '${fontName}'; 
  src: url('${fontName}.woff2') format('woff2'); 
  font-weight: normal; 
  font-style: normal; 
} 
[class^="icon-"], [class*=" icon-"] { 
  font-family: '${fontName}' !important; 
  speak: none; 
  font-style: normal; 
  font-weight: normal; 
  font-variant: normal; 
  text-transform: none; 
  line-height: 1; 
  -webkit-font-smoothing: antialiased; 
  -moz-osx-font-smoothing: grayscale; 
}`;
      const cssOutput = `${fontFace}\n\n${cssContent.join('\n')}`;
      saveFile(cssPath, cssOutput);

      console.log('Font generation complete! CSS and WOFF2 files have been generated.');
      rl.close();
    } catch (error) {
      console.error('Error during font generation:', error);
      rl.close();
    }
  });

  // Handle errors in the fontStream
  fontStream.on('error', (err) => {
    console.error('Error in SVGIcons2SVGFontStream:', err);
    rl.close();
  });
};

/**
 * Main execution function.
 */
(async () => { 
  const currentDir = process.cwd(); 
  const svgDirectory = path.join(currentDir, 'svg'); 
  const outputDirectory = path.join(currentDir, 'icons'); 
  const fontName = 'icons';

  // Check if SVG directory exists
  if (!fs.existsSync(svgDirectory)) {
    console.log("La cartella /svg non è stata trovata");
    process.exit(1);
  }

  const svgFiles = readSVGFiles(svgDirectory);
  if (svgFiles.length === 0) {
    console.log("Nessun file SVG trovato nella cartella /svg");
    process.exit(1);
  }

  let needConfirmation = false;
  if (fs.existsSync(outputDirectory)) {
    needConfirmation = true;
  } else {
    // Create necessary directories if they don't exist
    fs.mkdirSync(path.join(currentDir), { recursive: true });
    fs.mkdirSync(outputDirectory, { recursive: true });
  }

  /**
   * Proceeds with font generation if confirmed or if no confirmation is needed.
   */
  const proceed = () => {
    generateFont(svgFiles, fontName, outputDirectory);
  };

  if (needConfirmation) {
    rl.question('La cartella fonts/icons esiste già. Vuoi sovrascrivere? (s/n): ', (answer) => {
      if (answer.trim().toLowerCase() === 's') {
        proceed();
      } else {
        console.log('Operazione annullata.');
        rl.close();
      }
    });
  } else {
    proceed();
  }

})();
