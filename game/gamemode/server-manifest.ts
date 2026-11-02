// ==== thornswood server manifest ====
// -------------------------------------------------------------- manifest ---
// Where the client looks for the load order it is supposed to match.
//
// loadOrderVerificationService asks for
//
//     <master>/api/servers/<masterKey>/manifest.json
//
// and getMasterUrl falls back to https://gateway.skymp.net when the client's
// "master" setting is empty, while getServerMasterKey falls back to
// "<server-ip>:<port>". So an unregistered private server sends every person
// who presses Play to skymp.net asking about an address skymp.net has never
// heard of. Five attempts, five 404s, and an empty list comes back.
//
// An empty list is not treated as an error. The count check sees 61 against 0,
// prints the yellow "you have more mods than server" message for five seconds,
// and then the comparison loop runs over zero entries and passes. The load
// order has therefore never actually been checked on this server: the warning
// everybody has been ignoring was a failed lookup, and the check it belongs to
// was doing nothing at all.
//
// The server already writes the real thing. manifestGen.generateManifest runs
// at startup and puts filename, size and crc32 for every plugin in the load
// order into data/manifest.json, which the resources port serves. It is simply not at
// the path the client asks for. So it is published there as well.
//
// Filtered to plugins on the way past. The client compares this array
// POSITIONALLY against Game.getModName, which is plugins only, so a single bsa
// entry shifts everything after it and turns a healthy install into a red load
// order error. manifestGen only adds a bsa when one sits in dataDir, which is
// not where this setup keeps them, but the cost of being sure is one test.
(function () {
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { return; }
  if (!fs || !path) return;

  // Matches what the launcher writes into skymp5-client-settings.txt as
  // "server-master-key". A name rather than an address: this path ends up on
  // disk, and a colon is not allowed in a Windows file name.
  var KEY = 'thornswood';

  var dataDir = 'data';
  try {
    var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
    if (cfg && cfg.dataDir) dataDir = String(cfg.dataDir);
  } catch (e) { }

  var SRC = path.join(dataDir, 'manifest.json');
  var DIR = path.join(dataDir, 'api', 'servers', KEY);
  var DST = path.join(DIR, 'manifest.json');

  var PLUGIN = /\.(esp|esm|esl)$/i;

  // Thornswood's own plugins (#1180), which the manifest names as served so
  // the launcher can tell ours from another author's. Every other plugin in
  // the load order is somebody else's mod, which people get from its author
  // through Vortex and the collection. The bytes of ours are not served here
  // (#3386): this port is plain http, so the launcher's Fix takes them from
  // the signed release over https, by the sha256 its record gives them.
  // The names are the plugins scripts\release\Ship-Rules.ps1 calls ours
  // ($ShipOursFiles), and tests\test-1180-own-plugins.js holds the two lists
  // to each other, so a plugin the repo makes goes into both in one change.
  var OURS = { 'thornswood-content.esp': 1, 'thornswood-last.esp': 1 };

  // Returns '' once the manifest is published, otherwise why it was not.
  function publish() {
    var doc;
    try {
      doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
    } catch (e) {
      return 'could not read ' + SRC + ': ' + e.message;
    }
    if (!doc || !Array.isArray(doc.mods)) return SRC + ' has no mods list';

    function plugin(m) { return m && typeof m.filename === 'string' && PLUGIN.test(m.filename); }
    var mods = doc.mods.filter(plugin);
    // The light plugins, in light index order (#1715). The engine writes
    // them apart from mods once it loads light plugins: it reads which are
    // light from each header (the ESL flag, 0x200, or an .esl name), and
    // mods stays the full plugins because the client's own check walks it
    // position by position against Game.getModName, which counts full
    // plugins only. Read here, never decided again from the files, so the
    // server's answer is the one the launcher holds every machine's light
    // order to. An engine that loads no light plugin writes none, and then
    // none is published either: the client compares its light plugins with
    // the server's only when the manifest has the list, so an empty one
    // would tell everybody with a light plugin they have more than the
    // server.
    var hasLight = Array.isArray(doc.light);
    var light = hasLight ? doc.light.filter(plugin) : [];

    var out = {
      versionMajor: doc.versionMajor || 1,
      mods: mods,
      // The whole order, full and light together, the order the launcher
      // puts a plugin list into when there is a light list.
      loadOrder: Array.isArray(doc.loadOrder) ? doc.loadOrder : mods.map(function (m) { return m.filename; }),
      // Which of those are ours (#1180), full and light (#2627), the ones
      // the launcher's Fix puts in from the release (#3386). The client
      // reads mods, loadOrder and, when it is there, light, and never this
      // list.
      served: mods.concat(light).filter(function (m) { return OURS[m.filename.toLowerCase()]; })
                  .map(function (m) { return m.filename; })
    };
    if (hasLight) { out.light = light; }

    // Whole, never in place (#2740): a hot reload publishes it again while
    // clients and launchers may be asking the port for it.
    try {
      fs.mkdirSync(DIR, { recursive: true });
      mp.writeFileWhole(DST, JSON.stringify(out));
    } catch (e) {
      return 'could not write ' + DST + ': ' + e.message;
    }

    // Kept for the load order refusal below, which compares what a client
    // reports against exactly the list the client itself is compared with.
    globalThis.__thornswoodManifestMods = mods;
    // And the light list, null when the engine loads no light plugin, for
    // the same refusal's light half.
    globalThis.__thornswoodManifestLight = hasLight ? light : null;

    var dropped = doc.mods.length - mods.length;
    console.log('[thornswood] load order manifest published at /api/servers/' + KEY +
                '/manifest.json, ' + mods.length + ' plugins' +
                (light.length ? ' and ' + light.length + ' light plugins' : '') +
                (dropped > 0 ? ' (' + dropped + ' archive entries left out)' : ''));
    return '';
  }

  // Once, at load, with nothing trying again (#1885). The engine's main()
  // calls manifestGen.generateManifest, which writes data/manifest.json with
  // writeFileSync, and only after it returns does setupGamemode load this file
  // (skymp5-server/ts/index.ts at the commit records\server-build.json names;
  // tests\test-1885-manifest-order.js reads it there). A start whose
  // generateManifest throws never loads the gamemode at all. So the file is
  // complete when this runs, and a publish that fails here fails for a reason
  // no wait mends: the file unreadable, no mods in it, the api folder not
  // writable. Until 5 Oct a timer tried again every second for twenty seconds
  // and then stopped without a word.
  //
  // A manifest an earlier start published describes that start's plugins, so
  // it is taken off rather than left to answer for this one, and the refusal
  // below gets no list: the client, the launcher's Scan and the refusal then
  // find no manifest instead of a wrong one.
  var why = publish();
  if (why) {
    globalThis.__thornswoodManifestMods = null;
    var old = '';
    if (fs.existsSync(DST)) {
      try { fs.unlinkSync(DST); old = ' The one an earlier start published was taken off.'; }
      catch (e) { old = ' The one an earlier start published could not be taken off, so it still answers: ' + e.message + '.'; }
    }
    console.error('[thornswood] the load order manifest was NOT published at /api/servers/' + KEY +
                  '/manifest.json: ' + why + '.' + old + ' Until it is, launchers check no plugin bytes and ' +
                  'nobody\'s load order is checked. Nothing tries again: put the cause right and restart the server.');
  }
})();
// ==== end thornswood server manifest ====

