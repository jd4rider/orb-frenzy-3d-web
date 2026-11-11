/*
 * Unity <-> Little Joy Arcade bridge.
 * Owns the one key the arcade client mirrors for this game, and gives Unity a
 * small synchronous API: load the save, store the save, unlock an achievement.
 *
 * Copied from ~/programming/littlejoyarcade/UNITY_ACCOUNT_SAVE_BRIEF.md §4, with
 * GAME_ID filled in. The game id is also passed on the <script> tag by
 * scripts/prepare-site.mjs, so this fallback is only used if the tag loses its
 * attribute.
 */
(function () {
  var script = document.currentScript || document.querySelector('script[data-game-id]')
  var GAME = (script && script.dataset.gameId) || window.LJA_GAME_ID || 'orb-frenzy-3d'
  var KEY = 'lja:' + GAME + ':unity-save'
  var SESSION = 'lja:session'
  var API = 'https://fqovramltegcfiyebyrt.supabase.co'

  function anonKey() {
    var tag = document.querySelector('script[data-anon-key]')
    return (tag && tag.dataset.anonKey) || window.LJA_SUPABASE_ANON_KEY || ''
  }

  function read() {
    try {
      return localStorage.getItem(KEY) || ''
    } catch (e) {
      return ''
    }
  }

  function write(json) {
    try {
      localStorage.setItem(KEY, json)
      return true
    } catch (e) {
      return false
    }
  }

  function session() {
    try {
      var raw = localStorage.getItem(SESSION)
      return raw ? JSON.parse(raw) : null
    } catch (e) {
      return null
    }
  }

  function api() {
    return window.LittleJoyArcade || null
  }

  function sendStatus(text) {
    // ArcadeBridge lives on a DontDestroyOnLoad object in the boot scene.
    if (typeof SendMessage === 'function') {
      try {
        SendMessage('ArcadeBridge', 'OnArcadeStatus', String(text || ''))
      } catch (e) {
        /* object not created yet */
      }
    }
  }

  var shim = {
    gameId: GAME,
    load: read,
    save: function (json) {
      if (!json || typeof json !== 'string') return false
      var ok = write(json)
      var client = api()
      if (client && client.user()) {
        client.syncNow('game')
        sendStatus('Saving…')
      }
      return ok
    },
    clear: function () {
      try {
        localStorage.removeItem(KEY)
      } catch (e) {}
    },
    signedIn: function () {
      var client = api()
      return !!(client && client.user())
    },
    email: function () {
      var client = api()
      var user = client && client.user()
      return user && user.email ? user.email : ''
    },
    sync: function () {
      var client = api()
      if (client) client.syncNow('unity')
    },
    signOut: function () {
      var client = api()
      if (client) client.signOut()
    },
    openPanel: function () {
      // The account pill is inside the client's shadow root; click it.
      var host = document.querySelector('[data-lja-client]')
      var toggle = host && host.shadowRoot && host.shadowRoot.querySelector('.toggle')
      if (toggle) toggle.click()
    },
    status: function () {
      var client = api()
      return client ? client.status().text : 'Not signed in'
    },
    unlock: function (slug) {
      var s = session()
      var user = s && s.user ? s.user : null
      var anon = anonKey()
      if (!user || !s.access_token || !anon) return false
      var id = slug.indexOf('.') > 0 ? slug : GAME + '.' + slug
      fetch(API + '/rest/v1/player_achievements?on_conflict=user_id,achievement_id', {
        method: 'POST',
        headers: {
          apikey: anon,
          authorization: 'Bearer ' + s.access_token,
          'content-type': 'application/json',
          prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ user_id: user.id, achievement_id: id })
      })
        .then(function (res) {
          sendStatus(res.ok ? 'Achievement saved' : 'Achievement queued')
        })
        .catch(function () {
          sendStatus('Achievement queued')
        })
      return true
    }
  }

  // The client only mirrors keys it can see; `lja:` keys are excluded from its
  // automatic sweep, which is why these two hooks exist.
  window.LJA_SNAPSHOT = function () {
    var value = read()
    return value ? { 'unity-save': value } : {}
  }
  window.LJA_APPLY_SNAPSHOT = function (keys) {
    if (keys && typeof keys['unity-save'] === 'string') write(keys['unity-save'])
  }

  window.LJA_UnitySave = shim
})()
