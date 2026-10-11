// Thin wrapper around the YouTube Playables SDK (window.ytgame).
//
// Inside YouTube every call goes to the SDK. Outside YouTube (local dev, the web
// preview) the SDK is missing or IN_PLAYABLES_ENV is false, so we fall back to
// harmless local behaviour. Per the certification rules the game never uses
// browser storage, cookies, the browser's language setting or page-visibility
// events: the web preview build injects its own storage via
// window.__glowloopWebStore.

const yt = window.ytgame;
const inPlayables = Boolean(yt && yt.IN_PLAYABLES_ENV);

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[glowloop] SDK call failed', err);
    return undefined;
  }
}

let loadSucceeded = false;
let memoryStore = '';

export const platform = {
  inPlayables,

  firstFrameReady() {
    if (inPlayables) safe(() => yt.game.firstFrameReady());
  },

  gameReady() {
    if (inPlayables) safe(() => yt.game.gameReady());
  },

  /** Resolves to the saved string ('' when there is none or loading failed). */
  async loadData() {
    if (inPlayables) {
      try {
        const data = await withTimeout(
          yt.game.loadData().then((d) => ({ ok: true, d })),
          5000,
          { ok: false, d: '' },
        );
        loadSucceeded = data.ok;
        return data.d || '';
      } catch {
        return '';
      }
    }
    loadSucceeded = true;
    const web = window.__glowloopWebStore;
    return web ? web.load() : memoryStore;
  },

  /** Saves are only attempted after a successful load, as the SDK requires. */
  async saveData(str) {
    if (!loadSucceeded) return;
    if (inPlayables) {
      try {
        await yt.game.saveData(str);
      } catch (err) {
        console.warn('[glowloop] saveData failed', err);
        safe(() => yt.health.logWarning());
      }
      return;
    }
    const web = window.__glowloopWebStore;
    if (web) web.save(str);
    else memoryStore = str;
  },

  sendScore(value) {
    if (!inPlayables) return;
    const v = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)));
    safe(() => yt.engagement.sendScore({ value: v })?.catch?.(() => {}));
  },

  async getLanguage() {
    if (!inPlayables) return 'en';
    return withTimeout(yt.system.getLanguage(), 2000, 'en');
  },

  isAudioEnabled() {
    if (!inPlayables) return true;
    return safe(() => yt.system.isAudioEnabled()) !== false;
  },

  onAudioEnabledChange(cb) {
    if (inPlayables) safe(() => yt.system.onAudioEnabledChange(cb));
  },

  onPause(cb) {
    if (inPlayables) safe(() => yt.system.onPause(cb));
  },

  onResume(cb) {
    if (inPlayables) safe(() => yt.system.onResume(cb));
  },

  logError() {
    if (inPlayables) safe(() => yt.health.logError());
  },
};
