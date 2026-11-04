// Real-browser test: no OCR mocks. Server actions are disabled by the local harness.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SmartBillForm} from '/features/smart-bills/components/smart-bill-form';
import {readTicketLocally,clearLocalOcrCache} from '/features/smart-bills/browser-ocr';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const people=[{id:a,name:'Ana',status:'active',replaced:false},{id:b,name:'Luis',status:'active',replaced:false}];
const root=createRoot(document.getElementById('root'));
const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
async function until(test){const end=Date.now()+130000;while(Date.now()<end){const value=test();if(value)return value;await pause();}throw Error('Browser condition timed out');}
const button=name=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===name);
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const byLabel=(name,scope=document)=>[...scope.querySelectorAll('label')].find(el=>el.textContent.trim()===name)?.querySelector('input');
const results=[];
try{
 for(const file of ['01_guaviare_uy.png','03_piriapolis_uy.jpeg','04_bacar_uy.png']){
  clearLocalOcrCache();window.__ocrTrace=[];
  root.render(<SmartBillForm key={file} id={a} groupId={b} people={people} aiAvailable={false}/>);
  const input=await until(()=>document.querySelector('input[name="receipt"]'));
  const photo=new File([await(await fetch('/tests/fixtures/receipts/'+file)).blob()],file,{type:file.endsWith('jpeg')?'image/jpeg':'image/png'});
  const transfer=new DataTransfer();transfer.items.add(photo);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await pause();
  button('Leer foto gratis (OCR local)').click();
  await until(()=>button('Reemplazar borrador con datos detectados'));
  const result=await readTicketLocally(photo,()=>{});
  const currency=[...document.querySelectorAll('label')].find(el=>el.textContent.includes('Confirmar moneda del ticket'))?.querySelector('select');
  if(currency){currency.value='UYU';currency.dispatchEvent(new Event('change',{bubbles:true}));await pause();}
  button('Reemplazar borrador con datos detectados').click();
  await until(()=>document.querySelector('section[aria-label="Producto 1"]'));
  const rows=[...document.querySelectorAll('section[aria-label^="Producto "]')];
  assert(rows.length===result.extraction.items.length,'Some products were hidden');
  for(const row of rows){assert(!byLabel('Producto',row).disabled&&!byLabel('Cantidad',row).disabled&&!byLabel('Precio',row).disabled,'Product fields are disabled');for(const chip of row.querySelectorAll('button[aria-pressed]'))assert(chip.getAttribute('aria-pressed')==='false','Participant was preselected');}
  const bill=()=>JSON.parse(document.querySelector('[name="smartBill"]').value);
  assert(bill().items.every(item=>item.consumers.length===0),'Unexpected assignments');
  const missingQuantity=result.extraction.items.filter(item=>item.quantity===null).length;
  assert(bill().items.filter(item=>item.quantity==='').length===missingQuantity,'Missing quantity was invented');
  const mismatch=[...document.querySelectorAll('[role="alert"]')].some(el=>el.textContent.includes('La suma no coincide'));
  assert(mismatch===(result.analysis.totals.totalDifference!==null&&result.analysis.totals.totalDifference!=='0.00'),'Mismatch warning not visible');
  for(const name of ['Ana','Luis'])rows[0].querySelectorAll('button[aria-pressed]').forEach(chip=>{if(chip.textContent===name)chip.click();});await pause();
  assert(bill().items[0].consumers.length===2&&bill().items[0].split==='equal','Equal selection failed');
  const expected={ '01_guaviare_uy.png':{rows:5,sum:'1190.00',known:4,total:null},'03_piriapolis_uy.jpeg':{rows:6,sum:'5220.00',known:4,total:'5320.00'},'04_bacar_uy.png':{rows:3,sum:'1525.00',known:3,total:'1525.00'}}[file];
  assert(rows.length===expected.rows&&result.analysis.totals.itemsSum===expected.sum&&result.extraction.total===expected.total,'Real photo financial regression: '+file);
  assert(result.extraction.items.filter(item=>item.quantity!==null&&item.unitPrice!==null).length>=expected.known,'Quantity recovery regression');
  results.push({file,total:result.extraction.total,sum:result.analysis.totals.itemsSum,items:result.extraction.items,variant:result.selectedVariant,warnings:result.qualityWarnings,ui:{visibleRows:rows.length,initiallyUnselected:true,editable:true,missingQuantity,mismatch,equalSelection:true,currencyConfirmedByTest:!!currency},trace:window.__ocrTrace});
 }
 await fetch('/report',{method:'POST',body:JSON.stringify({done:true,results})});
}catch(error){await fetch('/report',{method:'POST',body:JSON.stringify({done:true,error:String(error),results})});}
