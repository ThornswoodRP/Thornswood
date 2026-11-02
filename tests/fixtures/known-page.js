// tests/fixtures/known-page.js
//
// The Known Issues page as the site serves it. Since #3140 it is written from
// the issue board: the bot puts the #known-issues list into
// data/from-bot/lists.json, and knownMarkdown in site/lib/pages.js turns that
// into the markdown /known and /api/page/known serve. The rows live on GitHub,
// so the part of the page the repository holds is the page around them: its
// title, its intro and its headings. A test that reads what the page says
// reads it through here, so it reads the same text a person sees, made by the
// same code.
//
//   const { knownPage } = require('./fixtures/known-page');
//   const md = knownPage();               // the page with no rows, or null
//   const md = knownPage(otherRoot);       // the same out of another checkout
//   const md = knownPage(null, lists);     // the page written from these lists
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const siteFiles = require('../site-files');

const REPO = path.join(__dirname, '..', '..');
const MARK = /\/\/ ==== thornswood lists ====([\s\S]*?)\/\/ ==== end thornswood lists ====/;

// The block between the markers in server.js, as { knownMarkdown,
// roadmapBoard, listTime }, or null.
function listWriters(serverSource) {
  const cut = MARK.exec(String(serverSource || ''));
  if (!cut) return null;
  return new Function(cut[1] + '\nreturn { knownMarkdown, roadmapBoard, listTime };')();
}

// knownMarkdown out of server.js, or null.
function knownWriter(serverSource) {
  const w = listWriters(serverSource);
  return w ? w.knownMarkdown : null;
}

// The page's markdown out of a checkout (this one by default), written from
// lists (an empty known list read just now by default), or null when
// server.js has no writer.
function knownPage(root, lists) {
  let src;
  try { src = siteFiles.source(path.join(root || REPO, 'site', 'server.js')); } catch (e) { return null; }
  const write = knownWriter(src);
  if (!write) return null;
  return write(lists || { at: new Date().toISOString(), known: [] });
}

module.exports = { knownPage, knownWriter, listWriters, MARK };
