/*
  A gallery picture's smaller copies (#3218; SMALL_WIDTHS in site/lib/uploads.js says
  why and what the site checks). The site cannot make a picture smaller, so
  the page that sends one does: the upload form on the front page (home.js)
  after each picture, and the hub's gallery for staff, for a picture that
  came without them (hub.js).

  One copy for each of WIDTHS the picture is wider than, drawn here at that
  width and the picture's shape, as WebP, or as JPEG in a browser that
  makes no WebP. Sent one at a time to POST /api/gallery/copy. send resolves
  { made, bad }: the widths the site took, and '' or a sentence saying the
  first that did not go and why. It never rejects.
*/
(function () {
  var WIDTHS = [800, 1600];

  function blobAt(image, width) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(image.height * width / image.width));
    var context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('this browser cannot draw it'));
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (webp) {
        if (webp && webp.type === 'image/webp') return resolve(webp);
        canvas.toBlob(function (jpeg) {
          if (jpeg) resolve(jpeg); else reject(new Error('this browser cannot save it'));
        }, 'image/jpeg', 0.85);
      }, 'image/webp', 0.8);
    });
  }

  // The same two minutes home.js gives anything with a body.
  function post(name, width, blob) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 120000);
    return fetch('/api/gallery/copy?name=' + encodeURIComponent(name) + '&w=' + width, {
      method: 'POST', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined,
      headers: { 'content-type': blob.type }, body: blob
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || ('the site answered ' + r.status));
      });
    }, function (e) {
      throw new Error(e && e.name === 'AbortError' ? 'the site did not answer in time' : 'the site could not be reached');
    }).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  function send(source, name) {
    if (!window.createImageBitmap) return Promise.resolve({ made: [], bad: 'This browser cannot make smaller copies' });
    return createImageBitmap(source).then(function (image) {
      var widths = WIDTHS.filter(function (n) { return n < image.width; });
      var made = [], bad = '', i = 0;
      function one() {
        if (i >= widths.length) { image.close(); return { made: made, bad: bad }; }
        var n = widths[i++];
        return blobAt(image, n).then(function (blob) { return post(name, n, blob); })
          .then(function () { made.push(n); }, function (e) {
            if (!bad) bad = 'Its ' + n + ' pixel copy did not go (' + e.message + ')';
          }).then(one);
      }
      return one();
    }, function () {
      return { made: [], bad: 'This browser could not read the picture to make its smaller copies' };
    });
  }

  window.galleryCopies = { widths: WIDTHS, send: send };
})();
