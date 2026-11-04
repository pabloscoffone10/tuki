// Uses the existing Vite dependency, an installed Chromium browser and locally cached
// spa/eng traineddata. No downloads, backend, Gemini, or paid provider calls.
import {createServer} from 'vite';
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const root=process.cwd(),dir=path.join(root,'tmp/receipt-browser-check',String(Date.now()));fs.mkdirSync(dir,{recursive:true});
const browser=process.env.TUKI_BROWSER??'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
for(const file of [browser,root+'/tmp/receipt-eval/spa.traineddata',root+'/tmp/receipt-eval/eng.traineddata'])if(!fs.existsSync(file))throw Error('Missing prerequisite: '+file);
fs.writeFileSync(dir+'/actions.js',"export async function saveExpense(){throw Error('Saving disabled');} export async function scanTicket(){throw Error('Gemini disabled');}");
fs.writeFileSync(dir+'/navigation.js','export function unstable_rethrow(){}');
fs.writeFileSync(dir+'/tesseract.js',`import Tesseract from '/node_modules/tesseract.js/dist/tesseract.esm.min.js';
export const PSM=Tesseract.PSM;
export async function createWorker(lang,oem,options){const w=await Tesseract.createWorker(lang,oem,{...options,workerPath:location.origin+'/local-worker.js',corePath:location.origin+'/local-core',langPath:location.origin+'/local-lang',gzip:false});const recognize=w.recognize.bind(w);w.recognize=async(...args)=>{const r=await recognize(...args);(window.__ocrTrace??=[]).push({width:args[0].width,height:args[0].height,text:r.data.text,confidence:r.data.confidence});return r;};return w;}`);
fs.writeFileSync(dir+'/index.html','<!doctype html><html><body><div id="root"></div><script>window.onerror=m=>fetch("/report",{method:"POST",body:JSON.stringify({done:true,error:String(m)})});window.onunhandledrejection=e=>fetch("/report",{method:"POST",body:JSON.stringify({done:true,error:String(e.reason)})});</script><script type="module" src="/tests/browser/receipt-ocr-entry.jsx"></script></body></html>');
let complete;const finished=new Promise(resolve=>{complete=resolve;});
const server=await createServer({configFile:false,root,resolve:{alias:[{find:/^@\/features\/finance\/actions$/,replacement:dir+'/actions.js'},{find:/^tesseract.js$/,replacement:dir+'/tesseract.js'},{find:/^next\/navigation$/,replacement:dir+'/navigation.js'},{find:'@',replacement:root}]},server:{host:'127.0.0.1',port:Number(process.env.TUKI_BROWSER_PORT??4180),strictPort:true,hmr:false,watch:{ignored:['**/tmp/**']}},esbuild:{jsx:'automatic'},plugins:[{name:'receipt-test-assets',resolveId(source,importer){if(source==='../actions'&&importer?.includes('/smart-bills/components/'))return dir+'/actions.js';},configureServer(s){s.middlewares.use((req,res,next)=>{const url=decodeURIComponent((req.url??'').split('?')[0]);let file;
 if(url.startsWith('/local-core/'))file=root+'/node_modules/tesseract.js-core/'+path.basename(url);
 else if(url==='/local-worker.js')file=root+'/node_modules/tesseract.js/dist/worker.min.js';
 else if(/^\/local-lang\/(spa|eng)\.traineddata$/.test(url))file=root+'/tmp/receipt-eval/'+path.basename(url);
 else if(url==='/report'&&req.method==='POST'){let data='';req.on('data',c=>data+=c);req.on('end',()=>{try{const report=JSON.parse(data);fs.writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));res.end('ok');if(report.done)complete(report);}catch(error){res.statusCode=400;res.end(String(error));}});return;}
 if(file){res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'text/javascript':'application/octet-stream');fs.createReadStream(file).pipe(res);return;}
 next();});}}]});
await server.listen();const url=`http://127.0.0.1:${server.config.server.port}/${path.relative(root,dir).replaceAll('\\','/')}/index.html`;
console.log('Real browser OCR and editor:',url);
const child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+dir+'/profile',url],{windowsHide:true,stdio:'ignore'});
const timeout=setTimeout(()=>complete({error:'Browser verification timed out'}),420000);
try{const report=await finished;console.log('Report:',dir+'/report.json');if(report.error){console.error(report.error);process.exitCode=1;}else for(const result of report.results)console.log(result.file,JSON.stringify({total:result.total,sum:result.sum,ui:result.ui}));}
finally{clearTimeout(timeout);child.kill();await server.close();}
