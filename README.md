# Glowloop

A firefly-lasso arcade game built for **YouTube Playables**.

Play it in the browser: https://nico0f.github.io/glowloop/

Draw a glowing line with your finger or mouse. When it closes into a loop, every
firefly inside is caught. Fireflies in the same color score the square of their
count, so 5 golds in one loop score 250 while a 3 + 2 mix scores 130. Chaining
loops quickly builds a combo multiplier. Your lantern slowly fades, and caught
fireflies refuel it. When the lantern goes dark, the run ends.

As the nights go on:

| Night | What changes |
| --- | --- |
| 1 | Two colors. The lantern only starts draining after your first catch on your very first game. |
| 2 | A third color. **Moths** appear: a loop that encloses a moth fails and costs glow. Moths are drawn to your light and chase your pen while you draw. |
| 3+ | The **golden firefly** flies fast across the field. Loop it for a 6.5 s **Frenzy**: every firefly counts as one color, moths flee and the lantern stops draining. |
| 4 | A fourth color. **Bats** swoop across and snap your line if they touch it (an arrow warns where they will enter). |
| 5+ | More moths, faster moths, faster drain. The drain keeps rising after Night 10, so every run ends. |

Nothing in the Playables catalog is built around drawing loops to catch things.
The core idea (encircle), color-group scoring and moths that follow your pen make
it play differently from the usual merge, sort and stack games.

## Run it

Needs Node 18 or newer. There are no dependencies to install.

```bash
npm run dev
```

Then open http://localhost:8080. The dev server sends the same
Content-Security-Policy header YouTube uses, so a blocked request shows up in the
console. Outside YouTube the SDK reports `IN_PLAYABLES_ENV = false` and the game
falls back to local behavior (the save only lives in memory).

```bash
npm test
```

Runs the unit tests for loop detection (`tests/trail.test.mjs`).

```bash
npm run build
```

Creates:

- `dist/glowloop-playables.zip`: the file you upload to YouTube (about 30 KiB).
- `dist/playables/`: the same files unzipped.
- `dist/web/`: a preview build without the SDK that keeps your best score in the browser.
  Every push to `main` deploys it to GitHub Pages (`.github/workflows/pages.yml`).

The build fails if the bundle breaks a certification rule it can check: banned
APIs (browser storage, cookies, `navigator.language`, Page Visibility, `eval`,
workers, dialogs), absolute paths, bad file names, size and file-count limits,
and the SDK tag not loading first.

## Test the YouTube integration

1. **Official test suite.** Run `npm run dev`, open the
   [Playables SDK Test Suite](https://developers.google.com/youtube/gaming/playables/test_suite)
   and enter `http://localhost:8080`. It runs the game inside a simulated
   YouTube frame, where you can trigger pause, resume, mute and saves.
2. **Local mock.** `node tools/serve.mjs . 8090`, then open
   http://localhost:8090/tests/harness/playables-mock.html. It loads the game with a
   fake `ytgame` that records every SDK call in `window.__mock.calls`, with
   `__mock.pause()`, `__mock.resume()` and `__mock.setAudio(false)` to drive it.
   It starts in Spanish with a saved best score of 4,321.

## Publish on YouTube

1. Get access to the YouTube Playables developer program (interest form on
   [developers.google.com/youtube/gaming/playables](https://developers.google.com/youtube/gaming/playables)).
2. In the Playables developer portal, create the game and upload
   `dist/glowloop-playables.zip`.
3. Add store metadata: title, description, genre and thumbnails. Thumbnails are in
   `store/thumbnails/` (see below). They must not carry branding or logos, so they
   have no text.
4. Submit for certification review.

## Store thumbnails

`store/thumbnails/` has PNGs in six shapes: 16:9 (1920×1080), 4:3 (1440×1080),
1:1 (1080×1080), 3:4 (1080×1440), 2:3 (1080×1620) and 9:16 (1080×1920). They are
drawn by the game's own renderer from a staged scene, so they always match the
current look of the game. To regenerate them:

```bash
npm run thumbnails
```

Then open http://localhost:8095/tools/thumbnails.html. The page renders every size
and the script writes the files. The scene is set up in `tools/thumbnails.html`.

## How the certification rules are met

| Rule | Where |
| --- | --- |
| SDK loads before any game code | `src/index.html` (first script in `<head>`) |
| `firstFrameReady` on the loading frame, `gameReady` once the title is interactive | `boot()` in `src/js/main.js` |
| Cloud save only through `saveData`, after `loadData` resolves; older saves load safely | `src/js/platform.js`, `applySave()` in `main.js` |
| Best score sent with `sendScore` matches the saved best | `onRunEnd` in `main.js` |
| Respects YouTube mute via `isAudioEnabled` / `onAudioEnabledChange`; no in-game mute button | `src/js/audio.js` |
| `onPause` stops the loop, rendering, input and audio; `onResume` restarts them behind a "Tap to continue" screen | `main.js` |
| No Page Visibility API, no `navigator.language` | enforced by `tools/build.mjs` |
| Any aspect ratio (9:32 to 32:9), state kept on resize, sharp on high-DPI screens | `Game.resize`, `Renderer.resize` |
| Touch and mouse for everything; Esc and P toggle pause without `preventDefault` on Esc; Enter/Space start and restart | `main.js` |
| No external requests, fonts or assets; all sound is synthesized | whole bundle |
| English plus Spanish, Portuguese, French, German and Italian from `getLanguage` | `src/js/i18n.js` |

## Project layout

```
src/                 the game, exactly what ships to YouTube
  index.html
  css/style.css
  js/main.js         boot, main loop, input, SDK lifecycle
  js/platform.js     YouTube Playables SDK wrapper with local fallbacks
  js/game.js         simulation, scoring, difficulty (levelParams, scoreLoop)
  js/trail.js        the drawn line and loop detection
  js/geometry.js     segment intersection, point in polygon, area
  js/render.js       canvas renderer (pre-rendered glow sprites)
  js/audio.js        procedural sound effects and music box
  js/i18n.js         UI strings
store/thumbnails/    store listing images
tests/               unit tests and the SDK mock harness
tools/serve.mjs      static server with the Playables CSP
tools/build.mjs      checks and packaging
tools/thumbnails.*   renders the store thumbnails
```

Tuning lives at the top of `src/js/game.js`: `levelParams()` (colors, moths,
drain, bats per night), `COMBO_WINDOW`, `LEVEL_SECONDS`, `MOTH_PENALTY` and
`FRENZY_SECONDS`.
