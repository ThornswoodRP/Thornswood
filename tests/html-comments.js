'use strict';
/*
  html-comments.js: the site's noComments for the harnesses (#5641).

    const { noComments } = require('./html-comments');
    noComments(text)     the text with its HTML comments out

  A harness that reads a file past its comments strips them the way the site
  does: noComments in site\lib\pages.js, lifted out of the site's lines block
  as the lines harnesses lift it, so there is one copy of it in JavaScript.
  One pass of /<!--[\s\S]*?-->/ can leave a new "<!--" behind, which is why
  no harness carries its own.
*/
const siteFiles = require('./site-files');

const cut = /\/\/ ==== thornswood lines ====([\s\S]*?)\/\/ ==== end thornswood lines ====/.exec(siteFiles.source());
if (!cut || cut[1].indexOf('function noComments(') < 0) {
  throw new Error('site/lib/pages.js has no noComments in its lines block');
}
module.exports = { noComments: new Function(cut[1] + '\nreturn noComments;')() };
