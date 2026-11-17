/* News screenshots: the same escaped markup on the server and in browsers. */
(function () {
  'use strict';
  function valid(image) {
    return !!image && typeof image.url === 'string' && typeof image.alt === 'string' &&
      /^https:\/\/thornswood\.net\/news-[a-z0-9][a-z0-9-]{0,119}\.(?:png|jpg|webp)$/.test(image.url) &&
      image.alt.trim().length > 0 && image.alt.length <= 160 && !/[\x00-\x1f\x7f\]]/.test(image.alt);
  }
  function parse(line) {
    var m = /^!\[([^\]\r\n]{1,160})\]\(([^\s]+)\)$/.exec(line);
    var image = m ? { url: m[2], alt: m[1].trim() } : null;
    return valid(image) ? image : null;
  }
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function html(image) {
    if (!valid(image)) return '';
    var url = esc(image.url), caption = esc(image.alt);
    return '<figure class="news-picture" style="margin:16px 0;max-width:960px">' +
      '<a href="' + url + '"><img src="' + url + '" alt="' + caption + '" loading="lazy" decoding="async" ' +
      'style="display:block;width:100%;height:auto"></a><figcaption>' + caption + '</figcaption></figure>';
  }
  var api = { parse: parse, valid: valid, html: html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ThornswoodNewsPictures = api;
}());
