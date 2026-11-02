'use strict';
// Real HTTP responses from an isolated copy. No live accounts or data.
const fs = require('fs'), path = require('path'), os = require('os');
const siteFiles = require('../../tests/site-files');
const http = require('http'), net = require('net'), {spawn} = require('child_process');
const assert = require('assert');
const app = path.join(__dirname, '..', '..', 'site');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-discovery-'));
let server;
const routes = ['/', '/world', '/rules', '/credits', '/join', '/classes', '/roadmap',
  '/news', '/gallery', '/downloads', '/report', '/known', '/help', '/privacy', '/terms', '/cookies'];
function ask(port, route, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({host:'127.0.0.1', port, path:route, headers, method, agent:false}, res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', b => body += b);
      res.on('end', () => resolve({status:res.statusCode, headers:res.headers, body}));
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout'))); req.end();
  });
}
/*
  Waits for the site's own "[thornswood-docs] listening on ...:port" line, so
  nothing is asked of the port before this run's site holds it (#1727). The
  port came from the system and was let go again, and builds run side by side
  on the VPS: if something takes it in between, the site stops on EADDRINUSE,
  and polling the port would have read whatever holds it as this site. The
  error says which, with what the site printed.
*/
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) { end(null); }
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}
async function main() {
  siteFiles.copy(work, path.join(app, 'server.js'));
  fs.cpSync(path.join(app, 'public'), path.join(work, 'public'), {recursive:true});
  fs.cpSync(path.join(app, 'data'), path.join(work, 'data'), {recursive:true});
  fs.writeFileSync(path.join(work, 'public', 'accidental.js.map'), '{"sourcesContent":["private source"]}');
  const cfg = JSON.parse(fs.readFileSync(path.join(app, 'config.example.json')));
  cfg.secret = 'disposable-site-test-secret'; cfg.password = 'disposable-test-password';
  fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(work, 'data', 'news.json'), JSON.stringify({launcher:'1.2.3',news:[
    {date:'2026-10-03', title:'A real release </script><script>alert(1)</script>', details:['Released safely.']}
  ]}));
  const port = await new Promise(resolve => {
    const s = net.createServer(); s.listen(0, '127.0.0.1', () => {const p=s.address().port;s.close(()=>resolve(p));});
  });
  server = spawn(process.execPath, [path.join(work, 'server.js')], {cwd:work,
    env:{...process.env, THORNSWOOD_DOCS_LOCAL:'1', THORNSWOOD_DOCS_PORT:String(port)}, stdio:'pipe'});
  let log = ''; server.stdout.on('data', b => log += b); server.stderr.on('data', b => log += b);
  await listening(server, port);
  const titles = new Set(), descriptions = new Set();
  for (const route of routes) {
    const r = await ask(port, route, {host:'untrusted.example', accept:'text/html'});
    assert.equal(r.status,200,route);
    const title = (r.body.match(/<title>([^<]+)<\/title>/)||[])[1];
    const desc = (r.body.match(/<meta name="description" content="([^"]+)"/ )||[])[1];
    assert(title && !titles.has(title), 'unique title '+route); titles.add(title);
    assert(desc && !descriptions.has(desc), 'unique description '+route); descriptions.add(desc);
    assert(r.body.includes('<link rel="canonical" href="https://thornswood.net'+route+'">'), 'canonical '+route);
    assert.equal((r.body.match(/<h1\b/g)||[]).length,1,'one source heading '+route);
    assert(r.body.includes('<main id="main" tabindex="-1">'), 'keyboard skip target accepts focus '+route);
    assert(r.body.includes('property="og:url" content="https://thornswood.net'+route+'"'), 'share URL '+route);
    const ld = (r.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)||[])[1];
    const graph = JSON.parse(ld)['@graph'];
    assert(graph.some(n=>n['@type']==='WebPage' && n.url==='https://thornswood.net'+route), 'page schema '+route);
    if(route!=='/') {
      assert(graph.some(n=>n['@type']==='BreadcrumbList'), 'breadcrumb schema '+route);
      assert(r.body.includes('aria-label="Breadcrumb"'), 'visible breadcrumbs '+route);
      assert(!r.body.includes('poster="/banner.jpg"'), 'no hidden home video '+route);
    }
    assert(!/\bVite\b|React App|lorem ipsum|DISCORD_URL/.test(r.body), 'no template defaults '+route);
  }
  const news=await ask(port,'/news');
  assert(news.body.includes('Released safely.'),'release details in initial HTML');
  assert(!news.body.includes('<script>alert(1)</script>'),'release titles escaped');
  const sitemap=await ask(port,'/sitemap.xml'); assert.equal(sitemap.status,200);
  for(const route of routes) assert(sitemap.body.includes('<loc>https://thornswood.net'+route+'</loc>'),'sitemap '+route);
  assert(!/\/hub|\/api\/|\/thanks/.test(sitemap.body),'no private or confirmation pages in sitemap');
  const robots=await ask(port,'/robots.txt');
  assert(robots.body.includes('Sitemap: https://thornswood.net/sitemap.xml'),'robots sitemap');
  assert(robots.body.includes('Disallow: /hub'),'private page crawl exclusions');
  const llms=await ask(port,'/llms.txt'); assert.equal(llms.status,200); assert(llms.body.includes('https://thornswood.net/rules'));
  const gone=await ask(port,'/this-page-does-not-exist',{accept:'text/html'});
  assert.equal(gone.status,404); assert(gone.body.includes('name="robots" content="noindex"'));
  assert(gone.body.includes('/favicon.ico')); assert.equal((gone.body.match(/<h1\b/g)||[]).length,1);
  assert.equal((await ask(port,'/accidental.js.map')).status,404,'source maps never served');
  const head=await ask(port,'/sitemap.xml',{},'HEAD'); assert.equal(head.status,200); assert.equal(head.body,'');
  assert.equal((await ask(port,'/rules',{host:'www.thornswood.net'})).headers.location,'https://thornswood.net/rules');
  const galleryRows=Array.from({length:75},(_,i)=>({name:'shot-'+i+'.png',url:'/shot/shot-'+i+'.png',by:'Test author'}));
  fs.writeFileSync(path.join(work,'data','gallery.json'),JSON.stringify(galleryRows));
  const publicData=JSON.parse((await ask(port,'/api/public?galleryLimit=24')).body);
  assert.equal(publicData.gallery.length,24);assert.equal(publicData.galleryNext,24);
  const legacyData=JSON.parse((await ask(port,'/api/public')).body);
  assert.equal(legacyData.gallery.length,75,'existing launcher still sees every approved picture');
  assert.equal(legacyData.galleryNext,null);
  const second=JSON.parse((await ask(port,'/api/gallery?offset=24&limit=24')).body);
  assert.equal(second.gallery[0].name,'shot-24.png');assert.equal(second.next,48);assert.equal(second.total,75);
  const last=JSON.parse((await ask(port,'/api/gallery?offset=72')).body);assert.equal(last.gallery.length,3);assert.equal(last.next,null);
  assert.equal((await ask(port,'/api/gallery?limit=10000')).status,400);
  fs.writeFileSync(path.join(work,'data','gallery.json'),'[]');
  assert.equal(JSON.parse((await ask(port,'/api/gallery')).body).total,0,'public cache invalidated after publication changes');
  const limited=await Promise.all(Array.from({length:125},()=>ask(port,'/api/gallery',{ 'x-forwarded-for':'192.0.2.44'})));
  assert.equal(limited.filter(r=>r.status===200).length,120,'read API cap under simultaneous requests');
  assert(limited.filter(r=>r.status===429).every(r=>Number(r.headers['retry-after'])>0),'read API retry guidance');
  const parallel=await Promise.all(Array.from({length:30},(_,i)=>ask(port,routes[i%routes.length])));
  assert(parallel.every(r=>r.status===200),'simultaneous public readers');
  console.log('PASS all public pages, metadata, source content, crawl files, 404, map exclusion, HEAD and 30 simultaneous readers');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(server && server.exitCode===null) { const exited=new Promise(r=>server.once('exit',r));server.kill();await exited; }
  fs.rmSync(work,{recursive:true,force:true});
});
