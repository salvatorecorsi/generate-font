# generate-font
Font generator from SVG files

Put your SVGs in ./svg and install deps (npm i svgicons2svgfont svg2ttf ttf2woff2); ensure Node 18+ and "type": "module" in package.json for ESM imports.
Run node build-icons.mjs from the project root: it creates ./icons/icons.woff2 and ./icons/icons.css; include the CSS and use classes like <i class="icon-[svg-filename]"></i>.
