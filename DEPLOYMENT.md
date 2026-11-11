# Deployment

Orb Frenzy 3D is a static Unity WebGL build. There is no bundler, no package manager and
no server code: `scripts/prepare-site.mjs` reshapes the export and GitHub Actions publishes
the result.

> **Current status: not deployed.** The code is finished and compiles clean, and the
> scaffold in this folder is ready, but nothing has been pushed yet — see
> [What is still missing](#what-is-still-missing).

## Where it lives

| Piece | Value |
| --- | --- |
| Repository | `jd4rider/orb-frenzy-3d-web` (public) — **does not exist yet** |
| Play URL | <https://jd4rider.github.io/orb-frenzy-3d-web/play/> |
| Cover page | <https://jd4rider.github.io/orb-frenzy-3d-web/> |
| Host | GitHub Pages, Actions source (`pages.yml`), no custom domain |
| Catalogue | `littlejoyarcade/src/data/games.ts` + a new `supabase/migrations/` entry |
| Portal entry | <https://littlejoyarcade.site/#/game/orb-frenzy-3d> |
| Game id | `orb-frenzy-3d` |

The portal embeds the `play/` URL in an iframe, so the game has to keep working inside a
nested browsing context: no custom domain, no service worker, no `X-Frame-Options`.

## Why no custom domain

GitHub gives a Pages site exactly one canonical hostname. A `CNAME` file or a Pages custom
domain would make `jd4rider.github.io/orb-frenzy-3d-web/` answer with a 301 to a hostname
whose certificate may not exist yet, and the arcade's embedded player would show a black
screen. Game repos therefore stay on `github.io`; the portal links that URL directly.

## What is still missing

Everything here is blocked on accounts and network access, not on code:

1. **The web repository does not exist.** `jd4rider/orb-frenzy-3d-web` has to be created
   (empty, public) before anything can be pushed.
2. **This folder is not its own git repository.** The pattern is one repo per game holding
   only `Deploy/`, separate from the Unity project — Gemstorm 3D is `gemstorm-3d-web`
   holding just a `Deploy/` tree. So: `git init` here, add the remote, commit, push.
3. **Pages must be switched to the Actions source** once, after the first push.
4. **The portal repo is not checked out on this machine**, and the Supabase CLI is not
   installed, so the catalogue row cannot be written from here.
5. **No WebGL build had ever been produced** from this project before — see
   [Refresh the payload](#refresh-the-payload).

## Deploy

From inside `Deploy/` (the root of the web repository):

```bash
git push origin main
gh run list --repo jd4rider/orb-frenzy-3d-web --limit 3
```

The workflow runs `node scripts/prepare-site.mjs`, asserts the payload is servable (wasm
magic bytes, no `.br` references, every required file present), asserts the arcade account
layer survived, uploads `site/` and deploys it. Pages must have its source set to **GitHub
Actions** once:

```bash
gh api -X POST repos/jd4rider/orb-frenzy-3d-web/pages -f build_type=workflow
```

## Verify a deploy

```bash
curl -sI https://jd4rider.github.io/orb-frenzy-3d-web/play/                     # 200 text/html
curl -sI https://jd4rider.github.io/orb-frenzy-3d-web/play/Build/WebGL.wasm
curl -s -r 0-3 https://jd4rider.github.io/orb-frenzy-3d-web/play/Build/WebGL.wasm | xxd -p
# expect 0061736d (\0asm) - a Brotli or gzip payload would start with something else
```

A 200 is not proof the game runs: open the URL in a browser and wait for the Unity progress
bar to disappear. The arcade client logs
`[LittleJoy] Running on local fallback (SDK not present).` to the console on a direct
visit, which is expected — the SDK only initialises when the page is loaded with
`?game_id=orb-frenzy-3d` from the portal.

## Refresh the payload

The Unity project lives separately (`~/Developer/Orb Frenzy 3D`). Its build script
`Assets/OrbFrenzy/Editor/BuildWebGL.cs` writes straight to `Deploy/build/WebGL/`:

```bash
/Applications/Unity/Hub/Editor/7000.0.0a12/Unity.app/Contents/MacOS/Unity \
  -batchmode -projectPath "/Users/jonathanforrider/Developer/Orb Frenzy 3D" \
  -executeMethod OrbFrenzy.EditorTools.BuildWebGL.Build -logFile /tmp/orbfrenzy-build.log
```

Or, with the editor already open, use the menu item **Tools ▸ Orb Frenzy ▸ Build WebGL**.
Either way the output lands in `Deploy/build/WebGL/`; commit it. Do **not** commit the
prepared `Deploy/site/` — CI regenerates it.

The build script pins the settings this deploy depends on:

- `compressionFormat = Disabled` — a Brotli export needs `Content-Encoding: br`, which
  Pages cannot send.
- `defaultWebScreenWidth/Height = 1080/1920` — portrait-first.
- `dataCaching = true` — repeat visits do not re-download the payload.
- `debugSymbolMode = Off` — keeps the wasm small.

## The embind shim (do not delete)

`Assets/Plugins/OrbFrenzy/OrbFrenzyEmbindShim.jslib` stubs `_emval_take_value` and
`_emval_as`. Unity 7000.0.0a12's Emscripten does not export those two symbols, but this
project pulls in `com.unity.ai.inference` → `com.unity.dt.app-ui`, whose
`Runtime/TextMateLib` emits a `bindings.cpp.o` that imports both. Without the shim, `wasm-ld`
fails the WebGL link with:

```
undefined symbol: _emval_take_value
```

The stubs are inert — nothing in Orb Frenzy calls into embind — so they only satisfy the
linker. Removing the file, or removing the package, breaks the build.

## What "the account layer survived" means

The Unity export regenerates `index.html` from its template on every build. If that file
replaces the prepared one, the game still boots — it just silently stops signing players in
and stops saving to the cloud. Three things guard against that:

1. `prepare-site.mjs` copies `public/arcade-unity.js` and `public/arcade-client.js` next to
   the build and injects their two `<script>` tags before `</body>`, shim first.
2. The same script throws if either file or either tag is missing, if the tags are in the
   wrong order, if the fill-the-window patch did not apply, or if the account pill's offset
   that clears the Unity footer is gone.
3. The `Check the arcade account layer survived` CI step re-asserts all of it from the
   generated `site/`, and refuses to ship anything containing `service_role`.

`arcade-client.js` is the platform's canonical file and must stay byte-identical. The pill it
renders is pinned with an inline style, so the page raises it over the Unity footer with an
`!important` rule in the injected CSS rather than by editing the client.

`arcade-unity.js` is **not** canonical — it is this game's shim, and its game-id fallback is
`orb-frenzy-3d`.

The fill-the-window patch is safe for this game because `Presentation/PortraitFrame` pins the
render to a centred 9:16 column whatever the page gives it, `PortraitLetterbox` masks the
leftover bands, `CameraFramer` reframes the playfield inside that column and `GameHUD` sizes
its canvas to it with `ConstantPixelSize`. A wide player frame therefore shows a portrait
game rather than a stretched one.

## Save format

The Unity side (`Assets/OrbFrenzy/Scripts/Platform/ArcadeSave.cs`) is local-first:

- `PlayerPrefs["lja.save"]` holds a `SaveEnvelope` — `{v, savedAt, payload}` where payload is
  `{bestScore, bestChain, highestTier, runs}`.
- `Boot()` reads local first, then adopts the page copy only when the page's `savedAt` is
  newer, so a stale cloud row can never roll a player back.
- The pre-account keys `OrbFrenzy.BestScore` / `OrbFrenzy.BestChain` are migrated once, when
  the save has no `savedAt` yet.
- One write per finished run, forced on game over, debounced to 1 s otherwise.
- Every bridge call is a no-op outside WebGL and wrapped in `try`/`catch`, so a page with no
  account shim plays exactly like a game with no accounts.

The page side mirrors it under the localStorage key
`lja:orb-frenzy-3d:unity-save`, through `window.LJA_SNAPSHOT` /
`window.LJA_APPLY_SNAPSHOT`, because the client excludes `lja:` keys from its automatic
sweep.

## Publishing to the catalogue

The portal reads its catalogue from the `public.games` table, falling back to
`src/data/games.ts`. A new game updates both:

```bash
cd ../littlejoyarcade
# 1. add the entry to src/data/games.ts
# 2. add the next supabase/migrations/NNNN_orb_frenzy_3d.sql, same shape as
#    0018_gemstorm_3d.sql
npx supabase link --project-ref fqovramltegcfiyebyrt
npx supabase db push --remote --include-all --yes
git add -A && git commit -m "Add Orb Frenzy 3D to the catalogue" && git push
```

`db push` is what makes the row live; the push to `main` is what rebuilds the portal site
itself. The `public.games` row must exist before cloud save can land, because
`game_progress.game_id` has a foreign key onto it.

Commit `arcade-manifest.json` alongside the catalogue change — it is the source of the
listing copy, the cover gradient and the `saveKey`.

## Rollback

Pages keeps the last deploy only. To roll back, revert the commit that changed
`build/WebGL/` and push:

```bash
git revert <sha> && git push
```
