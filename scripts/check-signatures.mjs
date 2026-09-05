// Self-contained browser gate: real public renderer, isolated fixture API.
// No live vault, settings, saved design or account is modified.
// SIGNATURES=a,b limits the houses; --houses-only skips the shared checks;
// SHOTS=1 (viewport) or SHOTS=full writes screenshots to shots/signatures/.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { PRESETS } from '../shared/presetCatalog.ts';
import { presetDesignDoc } from '../shared/presets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = path.join(root, 'scratchpad/gates/signatures');
const shots = path.join(root, 'shots/signatures');
mkdirSync(scratch, { recursive: true });
mkdirSync(shots, { recursive: true });
const signatures = PRESETS.filter(p => p.family === 'signature' && (!process.env.SIGNATURES || process.env.SIGNATURES.split(',').includes(p.id)));
const titles = ['The shape of a quiet morning', 'A field guide to distant places', 'Things worth keeping', 'What the light leaves behind'];
const posts = Array.from({length: 28}, (_, i) => ({
  path: `story-${i}.md`, title: titles[i % titles.length], date: `2026-08-${String(28-i).padStart(2,'0')}`,
  excerpt: 'Notes on attention, small discoveries, and finding something extraordinary in the everyday.',
  words: 800, readingMinutes: 4, tags: ['essays','observations'], folders: ['gallery'],
  banner: '/api/file?path=review.svg',
}));
const source = path.join(scratch, 'review.tsx');
writeFileSync(source, `import React from 'react';
import {createRoot} from 'react-dom/client';
import DesignedSite from '/@fs/${root}/client/design/DesignedSite.tsx';
import DesignCanvas from '/@fs/${root}/client/design/DesignCanvas.tsx';
import {buildPreviewContent} from '/@fs/${root}/client/design/previewContent.tsx';
import {useStore} from '/@fs/${root}/client/state.ts';
import {setLang} from '/@fs/${root}/client/i18n.ts';
const boot=JSON.parse(document.getElementById('vellum-boot').textContent);
const ar=boot.lang==='ar'; setLang(boot.lang);
const query=new URLSearchParams(location.search);
const posts=${JSON.stringify(posts)};
if(query.has('tex')) posts[0].path='sample.tex';
useStore.setState({siteName:ar?'دفاتر الضوء':'Fieldwork',tagline:ar?'ملاحظات عن الأماكن والأشياء التي تستحق الانتباه':'Notes from a world still worth exploring.',language:boot.lang,publicReads:true,admin:false,publicLayout:'designed',theme:boot.theme,
 tree:{name:'',path:'',type:'folder',children:posts.map(p=>({name:p.path,path:p.path,type:'file'}))},
 publicFoldersHome:true,publicFoldersNav:true,publicFolders:[{id:'gallery',slug:'gallery',title:ar?'المعرض':'Gallery',description:ar?'مجموعة من الملاحظات والصور':'A collection of notes and images',icon:'camera',count:28}],
 authorSites:[{url:'https://example.com/gallery',title:ar?'معرض الصور':'Photography gallery',description:'An independent collection of images and observations.',domain:'example.com'}]});
const content=buildPreviewContent({posts,noteMode:'sample'});
createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).has('canvas') ? <DesignCanvas route={query.has('article')?'article':'home'} design={boot.design} content={content} ownTheme fit='native' width={innerWidth}/> : <DesignedSite/>);
`);
let requestPaths=[];
const server = await createServer({configFile:false,root:path.join(root,'client'),plugins:[{
  name:'signature-fixture',configureServer(server){server.middlewares.use((req,res,next)=>{
    const url=new URL(req.url,'http://localhost');
    const json = body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
    if(url.pathname==='/api/posts')return json(posts);
    if(url.pathname==='/api/note') { requestPaths.push(url.searchParams.get('path')); return json({path:url.searchParams.get('path'),content:'# '+titles[0]+'\n\nThis is the preview summary. A carefully written opening should be available in every template.',frontmatter:{},mtimeMs:1}); }
    if(url.pathname==='/api/file') {res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g"><stop stop-color="#283d43"/><stop offset="1" stop-color="#b18c66"/></linearGradient></defs><path fill="url(#g)" d="M0 0h800v600H0z"/><circle cx="480" cy="220" r="160" fill="#d8ccad"/><path d="M0 450L360 260 800 540v60H0" fill="#233b35"/></svg>');return;}
    if(url.pathname==='/api/design/public')return json({design:presetDesignDoc(signatures[0],'en'),pages:[],notice:null});
    if(url.pathname.startsWith('/api/'))return json([]);
    if(url.pathname==='/' || url.pathname.startsWith('/folder/') || url.pathname.startsWith('/story-')) {
      const preset=PRESETS.find(p=>p.id===url.searchParams.get('id'))??signatures[0];
      const lang=url.searchParams.has('ar')?'ar':'en'; const design=presetDesignDoc(preset,lang);
      res.setHeader('Content-Type','text/html');
      const html='<!doctype html><html lang="'+lang+'" dir="'+(lang==='ar'?'rtl':'ltr')+'" data-theme="'+design.theme+'"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/app.css"></head><body><script type="application/json" id="vellum-boot">'+JSON.stringify({layout:'designed',lang,theme:design.theme,design})+'</script><div id="root"></div><script type="module" src="/@fs/'+source+'"></script></body></html>';
      server.transformIndexHtml(url.pathname,html).then(out=>res.end(out)); return;
    }
    next();
  });}
},react()],server:{host:'127.0.0.1',port:0,fs:{allow:[root]}}});
let browser;
try {
 await server.listen();
 const address=server.httpServer.address(); const base=`http://127.0.0.1:${address.port}`;
 browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 for(const preset of ((process.argv.includes('--features-only') || process.argv.includes('--smoke-only')) ? [] : signatures)) {
  for(const [width,ar] of [[1440,false],[390,false],[390,true]]) {
   // `.s-dsn` is the scroll container, so a full-page shot needs a tall window.
   const page=await browser.newPage({viewport:{width,height:process.env.SHOTS==='full'?2600:1000},reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/?id=${preset.id}${ar?'&ar':''}`);
   await page.waitForSelector(`[data-signature="${preset.id}"] .s-dsn-card, [data-signature="${preset.id}"] .s-dsn-list__item`);
   assert.equal(await page.locator('.s-blog-sites__card').count(),1,preset.id+' author gallery');
   assert.equal(await page.locator('.s-blog-folders__card').count(),1,preset.id+' collection gallery');
   assert(await page.locator('.s-dsg-nav__link[href="/folder/gallery"]').count()>0, preset.id+' collection navigation');
   assert((await page.locator('.s-dsg-nav__link[href="/topic/essays"]').allTextContents()).every(t=>t.trim().length>0),preset.id+' topic labels');
   const overflow=await page.locator('.s-dsn').evaluate(el=>el.scrollWidth>el.clientWidth+2);
   assert.equal(overflow,false,`${preset.id} ${width} ${ar} horizontal overflow`);
   if(process.env.SHOTS) await page.screenshot({path:path.join(shots,`${preset.id}-${width}${ar?'-ar':''}.png`),fullPage:process.env.SHOTS==='full'});
   if(width===1440) {
    if(await page.locator('a[href="/story-0"]').count()===0) {
     await page.locator('.s-blog-folders__card').click();
     await page.waitForSelector('.s-blog-folderhead__title');
   }
   const link=page.locator('a[href="/story-0"]').first();
    await link.scrollIntoViewIfNeeded();
    await page.mouse.move(0,0);
    await page.waitForTimeout(150);
    await link.hover(); await page.waitForSelector('.s-hovercard', {timeout:5000});
    assert.match(await page.locator('.s-hovercard').innerText(),/preview summary/);
    await page.mouse.move(0,0); await page.waitForSelector('.s-hovercard',{state:'detached'});
    await page.locator('.s-blog-folders__card').click();
    await page.waitForSelector('.s-blog-folderhead__title');
    assert.equal(await page.locator('.s-blog-folderhead__title').innerText(),'Gallery');
    assert.equal(await page.locator(`[data-signature="${preset.id}"]`).count(),1);
   }
   assert.deepEqual(errors,[],preset.id+' browser errors');
   await page.close();
  }
  console.log('PASS',preset.id,'desktop, phone, RTL, gallery, hover, collection route');
 }
 // The shared home features must also survive all non-signature presets.
 for(const preset of PRESETS.filter(p=>!process.argv.includes('--smoke-only') && !process.argv.includes('--houses-only') && (process.argv.includes('--features-only') || p.family!=='signature'))) {
   const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
   await page.goto(`${base}/?id=${preset.id}`);
   await page.waitForSelector('.s-blog-sites__card');
   assert.equal(await page.locator('.s-blog-folders__card').count(),1,preset.id+' collection');
   if(await page.locator('a[href="/story-0"]').count()===0) {
     await page.locator('.s-blog-folders__card').click();
     await page.waitForSelector('.s-blog-folderhead__title');
   }
   const link=page.locator('a[href="/story-0"]').first();
   await link.scrollIntoViewIfNeeded(); await page.mouse.move(0,0); await page.waitForTimeout(150);
   await link.hover(); await page.waitForSelector('.s-hovercard',{timeout:5000});
   assert.match(await page.locator('.s-hovercard').innerText(),/preview summary/);
   await page.close();
 }
 if(!process.argv.includes('--smoke-only') && !process.argv.includes('--houses-only')) console.log('PASS all 81 templates: author galleries, collections and hover summaries');
 if(process.argv.includes('--houses-only')) { console.log(`PASS requested houses. Screenshots: ${shots}`); await browser.close(); await server.close(); process.exit(0); }
 const keyboard=await browser.newPage({viewport:{width:1440,height:1000}});
 await keyboard.goto(`${base}/?id=mission-control`);
 const first=keyboard.locator('a[href="/story-0"]').first();
 await first.waitFor(); await first.scrollIntoViewIfNeeded(); await keyboard.waitForTimeout(150);
 await keyboard.keyboard.press('Tab'); await first.focus();
 await keyboard.waitForSelector('.s-hovercard',{timeout:5000});
 await first.click(); await keyboard.waitForSelector('.s-dsn-article .s-rv');
 assert.match(await keyboard.locator('.s-dsn-article .s-rv').innerText(),/preview summary/);
 await keyboard.close();
 const canvas=await browser.newPage({viewport:{width:1440,height:1000}});
 await canvas.goto(`${base}/?id=mission-control&canvas`);
 await canvas.waitForSelector('.s-blog-sites__card');
 assert.equal(await canvas.locator('.s-blog-folders__card').count(),1);
 assert.equal(await canvas.locator('[data-signature="mission-control"]').count(),1);
 await canvas.goto(`${base}/?id=mission-control&canvas&article&tex`);
 await canvas.waitForSelector('.s-dsn-article .s-rv-h2');
 await canvas.close();
 console.log('PASS keyboard summary, article rendering and designer gallery parity');
 assert(!requestPaths.some(p=>p?.startsWith('folder/')),'collection navigation must never fetch a note preview');
 console.log(`PASS requested signature checks. Screenshots: ${shots}`);
} finally { await browser?.close(); await server.close(); }
