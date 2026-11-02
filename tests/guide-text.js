'use strict';
// The Developer Guide's text, for a harness that holds the guide to a rule.
//
// The guide was one file, Developer-Guide.md, until 1 Nov 2026 (plan line 39
// of the 31 Oct redesign). It is now an index, Developer-Guide.md, and one
// short page per task in docs/guide. A harness that checks what one section
// says reads that section's page. A harness that checks what the guide says
// as a whole (a rule that may sit on any page, or a line that must be on none)
// reads whole(), so a section moving from one page to another does not make
// a check pass by reading nothing.
//
// pages() lists the pages in the order of the index's "The pages" table, which
// is the guide's own order, so nothing here keeps a second list of them. It
// throws when the table names a page that is not there, or a page in
// docs/guide is not in the table, since then whole() would leave text out.
//
// whole() is the index and then every page, each as it is on disk with CR
// taken out, joined by a blank line.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = 'Developer-Guide.md';
const DIR = path.join('docs', 'guide');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
}

function pages() {
  const index = read(INDEX);
  const at = index.indexOf('\n## The pages\n');
  if (at < 0) throw new Error(INDEX + ' has no "The pages" table');
  const end = index.indexOf('\n## ', at + 1);
  const table = index.slice(at, end < 0 ? index.length : end);
  const named = [];
  const re = /^\| \[[^\]]+\]\((docs\/guide\/[\w-]+\.md)\) \|/gm;
  let m;
  while ((m = re.exec(table)) !== null) named.push(m[1]);
  if (!named.length) throw new Error(INDEX + ' "The pages" table names no page');
  const onDisk = fs.readdirSync(path.join(ROOT, DIR)).filter((f) => /\.md$/.test(f)).map((f) => 'docs/guide/' + f);
  const gone = named.filter((p) => onDisk.indexOf(p) < 0);
  const unlisted = onDisk.filter((p) => named.indexOf(p) < 0);
  if (gone.length) throw new Error(INDEX + ' names pages that are not there: ' + gone.join(', '));
  if (unlisted.length) throw new Error('pages in docs/guide that ' + INDEX + ' does not list: ' + unlisted.join(', '));
  return named.map((rel) => ({ rel: rel, text: read(rel) }));
}

function whole() {
  return [read(INDEX)].concat(pages().map((p) => p.text)).join('\n\n');
}

function page(name) {
  return read('docs/guide/' + name + '.md');
}

module.exports = { pages: pages, whole: whole, page: page, INDEX: INDEX };
