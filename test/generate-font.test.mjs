import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../generate-font.mjs', import.meta.url));
const triangle = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 22L12 2L22 22Z"/></svg>';
const square = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2H22V22H2Z"/></svg>';

async function createWorkspace(context, glyphs = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'generate-font-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, 'svg'));
  await Promise.all(Object.entries(glyphs).map(([name, content]) => writeFile(path.join(workspace, 'svg', name), content)));
  return workspace;
}

function runCli(workspace, argumentsList = []) {
  const result = spawnSync(process.execPath, [cliPath, ...argumentsList], {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.ifError(result.error);
  return result;
}

function assertSuccess(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function assertFailure(result) {
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
}

async function readCodepoints(workspace, output = 'icons', name = 'icons') {
  return JSON.parse(await readFile(path.join(workspace, output, `${name}.json`), 'utf8'));
}

async function readOutputFiles(directory) {
  const filenames = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return Object.fromEntries(await Promise.all(filenames.sort().map(async (filename) => [filename, await readFile(path.join(directory, filename))])));
}

test('generates valid WOFF2 and TTF with matching CSS, preview and codepoints', async (context) => {
  const workspace = await createWorkspace(context, { '-Arrow left-.SVG': triangle, 'settings.svg': square });
  assertSuccess(runCli(workspace));

  const files = await readOutputFiles(path.join(workspace, 'icons'));
  assert.deepEqual(Object.keys(files), ['icons.css', 'icons.html', 'icons.json', 'icons.ttf', 'icons.woff2']);
  assert.equal(files['icons.woff2'].toString('ascii', 0, 4), 'wOF2');
  assert.equal(files['icons.woff2'].readUInt32BE(8), files['icons.woff2'].byteLength);
  assert.equal(files['icons.ttf'].readUInt32BE(0), 0x00010000);

  const codepoints = await readCodepoints(workspace);
  assert.deepEqual(Object.keys(codepoints).sort(), ['Arrow-left', 'settings']);
  assert.equal(new Set(Object.values(codepoints)).size, 2);
  const css = files['icons.css'].toString();
  const preview = files['icons.html'].toString();
  assert.match(css, /icons\.woff2/);
  for (const [name, codepoint] of Object.entries(codepoints)) {
    assert.ok(Number.isInteger(codepoint) && codepoint >= 0xe000 && codepoint <= 0xf8ff);
    assert.ok(css.includes(`.icon-${name}`));
    assert.ok(css.includes(`\\${codepoint.toString(16)}`));
    assert.ok(preview.includes(`icon-${name}`));
  }
});

test('keeps codepoints stable across additions, removals and restored glyphs', async (context) => {
  const workspace = await createWorkspace(context, { 'middle.svg': triangle, 'zebra.svg': square });
  assertSuccess(runCli(workspace));
  const original = await readCodepoints(workspace);
  await writeFile(path.join(workspace, 'icons', 'keep.txt'), 'unrelated file');
  await writeFile(path.join(workspace, 'svg', 'aardvark.svg'), square);
  await rm(path.join(workspace, 'svg', 'zebra.svg'));

  assertSuccess(runCli(workspace));
  const updated = await readCodepoints(workspace);
  assert.equal(updated.middle, original.middle);
  assert.equal(updated.zebra, original.zebra);
  assert.ok(!Object.values(original).includes(updated.aardvark));
  assert.equal(await readFile(path.join(workspace, 'icons', 'keep.txt'), 'utf8'), 'unrelated file');
  const css = await readFile(path.join(workspace, 'icons', 'icons.css'), 'utf8');
  assert.ok(css.includes('.icon-aardvark'));
  assert.ok(!css.includes('.icon-zebra'));

  await writeFile(path.join(workspace, 'svg', 'zebra.svg'), square);
  assertSuccess(runCli(workspace));
  assert.deepEqual(await readCodepoints(workspace), updated);
  assert.ok((await readFile(path.join(workspace, 'icons', 'icons.css'), 'utf8')).includes('.icon-zebra'));
});

test('conversion errors preserve previous outputs and leave no files on a first build', async (context) => {
  const workspace = await createWorkspace(context, { 'valid.svg': triangle });
  assertSuccess(runCli(workspace));
  const original = await readOutputFiles(path.join(workspace, 'icons'));
  const invalidGlyphs = [
    '<svg><path d="M0 0',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="completely invalid"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" d="M2 22L12 2L22 22Z"/></svg>',
  ];

  for (const source of invalidGlyphs) {
    await writeFile(path.join(workspace, 'svg', 'broken.svg'), source);
    assertFailure(runCli(workspace));
    assert.deepEqual(await readOutputFiles(path.join(workspace, 'icons')), original);

    const firstBuild = await createWorkspace(context, { 'broken.svg': source });
    assertFailure(runCli(firstBuild));
    assert.deepEqual(await readOutputFiles(path.join(firstBuild, 'icons')), {});
  }
});

test('invalid mappings are rejected without replacing existing outputs', async (context) => {
  const workspace = await createWorkspace(context, { 'valid.svg': triangle });
  assertSuccess(runCli(workspace));

  for (const mapping of ['{"valid":', '{"valid":57344,"other":57344}']) {
    await writeFile(path.join(workspace, 'icons', 'icons.json'), mapping);
    const original = await readOutputFiles(path.join(workspace, 'icons'));
    assertFailure(runCli(workspace));
    assert.deepEqual(await readOutputFiles(path.join(workspace, 'icons')), original);
  }
});

test('supports custom paths and rejects collisions, empty input and invalid arguments', async (context) => {
  const workspace = await createWorkspace(context, { 'arrow.svg': triangle });
  const help = runCli(workspace, ['--help']);
  assertSuccess(help);
  assert.match(help.stdout, /--input/);
  assert.match(help.stdout, /--output/);
  assert.match(help.stdout, /--name/);
  assert.deepEqual(await readOutputFiles(path.join(workspace, 'icons')), {});

  await mkdir(path.join(workspace, 'source icons'));
  await writeFile(path.join(workspace, 'source icons', 'star.svg'), square);
  assertSuccess(runCli(workspace, ['--input', './source icons', '--output', './built fonts', '--name', 'project_icons-2']));
  assert.ok(Object.hasOwn(await readCodepoints(workspace, 'built fonts', 'project_icons-2'), 'star'));

  for (const argumentsList of [
    ['--input', './missing'],
    ['--input', './svg/arrow.svg'],
    ['--output', './svg/arrow.svg'],
    ['--name', '1icons'],
    ['--name', 'bad name'],
    ['--name', '../icons'],
    ['--name', 'a'.repeat(64)],
    ['--unknown'],
    ['--input'],
  ]) {
    assertFailure(runCli(workspace, argumentsList));
  }

  const empty = await createWorkspace(context);
  assertFailure(runCli(empty));
  assert.deepEqual(await readOutputFiles(path.join(empty, 'icons')), {});

  const collision = await createWorkspace(context, { 'arrow left.svg': triangle, 'arrow-left.svg': square });
  assertFailure(runCli(collision));
  assert.deepEqual(await readOutputFiles(path.join(collision, 'icons')), {});
});
