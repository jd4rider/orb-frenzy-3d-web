#!/usr/bin/env node
/*
 * Turn the Unity export into a static site GitHub Pages can actually serve.
 *
 *   node scripts/prepare-site.mjs
 *
 * `build/WebGL/` is the untouched Unity export (written by
 * Assets/OrbFrenzy/Editor/BuildWebGL.cs). `site/` is generated and not committed; CI
 * rebuilds it on every push.
 *
 * Four things are handled here, and each one fails loudly rather than in a player's
 * console:
 *
 *  1. Compression. A Brotli export needs `Content-Encoding: br`, which Pages cannot
 *     send, so the loader would die before the first frame. Any `.br` payload is
 *     expanded and `index.html` pointed at the plain names. The current export is
 *     already uncompressed, so that path is a no-op — but a future export that turns
 *     Brotli back on still deploys.
 *  2. Layout. The stock template pins a fixed 960x600 play area and stretches the
 *     canvas on phones. Orb Frenzy reframes its own playfield to whatever canvas it is
 *     given (Presentation/CameraFramer), so the canvas is made to fill the window instead.
 *  3. Accounts. `public/arcade-unity.js` and the canonical `public/arcade-client.js`
 *     are copied next to the build and their two tags injected. This is the step that
 *     silently strips login if a Unity re-export replaces index.html, which is why
 *     the assertions at the end check for both files and both tags.
 */
import { brotliDecompressSync } from 'node:zlib'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'build/WebGL')
const publicDir = join(root, 'public')
const site = join(root, 'site')
const play = join(site, 'play')

/** Must match the `public.games` row and the manifest. */
const GAME_ID = 'orb-frenzy-3d'
const TITLE = 'Orb Frenzy 3D'
const BACKGROUND = '#120a20'

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const LANDING = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${TITLE}</title>
    <meta http-equiv="refresh" content="0;url=./play/">
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        display: grid; place-items: center; background: ${BACKGROUND}; color: #e7ecfb;
        font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      main { text-align: center; padding: 24px; }
      a { color: #8ed8ff; }
    </style>
  </head>
  <body>
    <main>
      <h1>${TITLE}</h1>
      <p><a href="./play/">Play</a></p>
    </main>
  </body>
</html>
`

/** `WebGL.data.br` -> `WebGL.data` (path only, the extension comes off). */
function plainPath(path) {
  return path.slice(0, -'.br'.length)
}

/** Index just past the brace that closes the block opened at `from`. */
function matchBrace(text, from) {
  let depth = 0
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  throw new Error('unbalanced braces in the Unity template')
}

/* The canvas fills the window; the game frames the board inside it. The stock template
 * centres a fixed pixel box, which would leave the board small on a desktop and
 * letterboxed on a phone. */
const FILL_SCRIPT = `        // Injected by scripts/prepare-site.mjs. The game frames its own board to whatever
        // canvas size it is given, so the canvas simply fills the window.
        document.querySelector("#unity-container").className = "unity-desktop";
        document.querySelector("#unity-fullscreen-container").style.width = "";
        document.querySelector("#unity-fullscreen-container").style.height = "";`

const CSS = `<style>
      /* Injected by scripts/prepare-site.mjs. */
      html, body { margin: 0; height: 100%; overflow: hidden; background: ${BACKGROUND}; overscroll-behavior: none; }
      #unity-container.unity-desktop {
        position: fixed; inset: 0; left: 0; top: 0; transform: none;
        width: 100%; height: 100%; display: flex; flex-direction: column;
      }
      #unity-fullscreen-container { flex: 1 1 auto; width: 100% !important; height: auto !important; min-height: 0; }
      #unity-canvas { touch-action: none; }
      #unity-footer { flex: 0 0 auto; min-height: 38px; }
      /* The arcade client pins its 42px account pill to the bottom-left with an INLINE
         style, and the Unity footer's logo sits in exactly the same corner. Only an
         !important rule from a sheet can lift the pill, so it is raised clear of the
         38px footer and the client file stays byte-identical to the platform copy. */
      [data-lja-client] { bottom: 46px !important; }
      @media (max-width: 700px) { #unity-footer { display: none; } }
    </style>`

async function main() {
  const buildInfo = await stat(source).catch(() => null)
  if (!buildInfo?.isDirectory()) throw new Error(`missing Unity export at ${source}`)

  await rm(site, { recursive: true, force: true })
  await mkdir(play, { recursive: true })

  for (const entry of ['index.html', 'Build', 'StreamingAssets', 'TemplateData']) {
    const from = join(source, entry)
    if (!(await stat(from).catch(() => null))) continue
    await cp(from, join(play, entry), { recursive: true })
  }

  // 1. Brotli payload -> plain files the browser can read without a header.
  const buildDir = join(play, 'Build')
  const entries = await readdir(buildDir)
  const packedFiles = entries.filter((entry) => entry.endsWith('.br'))
  let compressed = 0
  let expanded = 0
  for (const entry of packedFiles) {
    const packed = join(buildDir, entry)
    const bytes = await readFile(packed)
    const plain = brotliDecompressSync(bytes)
    compressed += bytes.byteLength
    expanded += plain.byteLength
    await writeFile(plainPath(packed), plain)
    await rm(packed)
  }
  if (packedFiles.length === 0) {
    console.log('payload is already uncompressed: nothing to expand')
  } else {
    console.log(`decompressed ${packedFiles.length} files, ${mb(compressed)} -> ${mb(expanded)}`)
  }

  const indexPath = join(play, 'index.html')
  let html = await readFile(indexPath, 'utf8')

  // 2. Point the loader at the uncompressed names.
  const before = (html.match(/\.br"/g) ?? []).length
  if (before !== packedFiles.length) {
    throw new Error(`index.html references ${before} .br files but the build has ${packedFiles.length}`)
  }
  html = html.replaceAll('.br"', '"')

  // 3. Layout: one fill-to-window rule replaces both template branches.
  const marker = 'if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent))'
  const start = html.indexOf(marker)
  if (start === -1) throw new Error('Unity template changed: could not find the user-agent layout branch')
  const mobileEnd = matchBrace(html, html.indexOf('{', start))
  const elseBlock = /^\s*else\s*\{/.exec(html.slice(mobileEnd))
  if (!elseBlock) throw new Error('Unity template changed: the layout branch has no else block')
  const end = matchBrace(html, mobileEnd + elseBlock[0].length - 1)
  html = html.slice(0, start) + FILL_SCRIPT + html.slice(end)
  if (!html.includes('unity-container").className')) throw new Error('canvas fill patch did not apply')
  if (html.includes('navigator.userAgent')) throw new Error('user-agent layout branch survived the patch')

  // 4. Page furniture: a title worth sharing, a viewport phones honour, and the game's
  //    own colour behind everything while the payload streams in.
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`)
  if (!html.includes('name="viewport"')) {
    html = html.replace('</head>', `  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${CSS}\n  </head>`)
  } else if (!html.includes('viewport-fit=cover')) {
    html = html.replace('</head>', `${CSS}\n  </head>`)
  }

  // 5. The account layer. Both files are copied next to the build, then both tags are
  //    injected in the order the brief requires (shim first: it defines LJA_UnitySave,
  //    which the client reads through LJA_SNAPSHOT).
  for (const file of ['arcade-unity.js', 'arcade-client.js']) {
    const from = join(publicDir, file)
    const info = await stat(from).catch(() => null)
    if (!info?.isFile()) throw new Error(`missing public/${file}`)
    await cp(from, join(play, file))
  }

  const tags = [
    `<script src="./arcade-unity.js" data-game-id="${GAME_ID}"></script>`,
    `<script src="./arcade-client.js" data-game-id="${GAME_ID}"></script>`,
  ]
  const missing = tags.filter((tag) => !html.includes(tag))
  if (missing.length > 0) {
    if (!html.includes('</body>')) throw new Error('index.html has no </body> to inject the account tags before')
    html = html.replace('</body>', `  ${missing.join('\n  ')}\n  </body>`)
  }

  await writeFile(indexPath, html)
  await writeFile(join(site, 'index.html'), LANDING)

  // 6. Fail loudly here rather than in a player's console.
  const required = [
    'Build/WebGL.loader.js',
    'Build/WebGL.data',
    'Build/WebGL.wasm',
    'Build/WebGL.framework.js',
    'TemplateData/style.css',
    'arcade-unity.js',
    'arcade-client.js',
  ]
  for (const file of required) {
    const info = await stat(join(play, file)).catch(() => null)
    if (!info?.isFile()) throw new Error(`site/play/${file} is missing from the build`)
  }

  const written = await readFile(indexPath, 'utf8')
  if (written.includes('.br"')) throw new Error('index.html still references compressed payload')
  if (!written.includes('[data-lja-client] { bottom: 46px !important; }')) {
    throw new Error('site/play/index.html lost the account-pill offset that clears the Unity footer')
  }
  if (!written.includes('unity-container").className')) throw new Error('site/play/index.html lost the fill patch')
  for (const tag of tags) {
    if (!written.includes(tag)) throw new Error(`site/play/index.html is missing the account tag: ${tag}`)
  }
  if (written.indexOf('arcade-unity.js') > written.indexOf('arcade-client.js')) {
    throw new Error('account tags are in the wrong order: the shim must load before the client')
  }

  console.log(`site/ is ready: site/play/ serves the Unity build with the arcade account layer (${GAME_ID})`)
}

main().catch((error) => {
  console.error(`prepare-site failed: ${error.message}`)
  process.exit(1)
})

export { plainPath }
