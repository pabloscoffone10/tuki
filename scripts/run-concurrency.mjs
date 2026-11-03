// Never reads .env.local, accepts remote hosts or drops an existing database.
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
const suites=[
 ['groups','TUKI_TEST_DATABASE_URL','tuki_phase3_test'],
 ['finance','TUKI_FINANCE_TEST_DATABASE_URL','tuki_phase4_test'],
 ['smart-bill','TUKI_SMART_TEST_DATABASE_URL','tuki_phase45_test'],
 ['payments','TUKI_PAYMENTS_TEST_DATABASE_URL','tuki_phase5_test'],
 ['notifications','TUKI_NOTIFICATIONS_TEST_DATABASE_URL','tuki_phase6_test'],
 ['admin-payment','TUKI_ADMIN_PAYMENTS_TEST_DATABASE_URL','tuki_admin_payments_test'],
 ['beta-finance','TUKI_BETA_TEST_DATABASE_URL','tuki_beta_test'],
];
const mode=process.argv[2]??'--check';
const available=spawnSync('docker',['compose','version'],{stdio:'ignore',windowsHide:true}).status===0;
if(mode==='--check'){console.log(available?'Docker Compose disponible.':'Docker Compose no disponible. Pruebas reales pendientes; no se ejecutó SQL.');process.exit(available?0:2);}
if(!['--docker','--local'].includes(mode))throw Error('Usá --check, --docker o --local.');
const project=`tuki-beta-${Date.now()}`;
const compose=['compose','-f','docker/compose.concurrency.yml','-p',project];
let databaseUrl;
if(mode==='--docker'){
 if(!available)throw Error('Docker Compose no disponible; no se ejecutaron pruebas reales.');
 databaseUrl='postgresql://tuki_test_owner:local-disposable-tests-only@127.0.0.1:55439/postgres';
}else databaseUrl=process.env.TUKI_CONCURRENCY_LOCAL_URL;
if(!databaseUrl)throw Error('Definí TUKI_CONCURRENCY_LOCAL_URL para una instalación LOCAL aislada.');
const base=new URL(databaseUrl);
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.pathname!=='/postgres'||base.search||base.hash)throw Error('Solo localhost y la base administrativa /postgres, sin parámetros.');
let started=false,failed=false;
try{
 if(mode==='--docker'){
  started=true;
  if(spawnSync('docker',[...compose,'up','--wait','--wait-timeout','90'],{stdio:'inherit',windowsHide:true}).status!==0)throw Error('No inició el PostgreSQL descartable.');
 }else{
  const owner=new Client({connectionString:databaseUrl});await owner.connect();
  try{
   for(const [,,database] of suites){if((await owner.query('select 1 from pg_database where datname=$1',[database])).rowCount)throw Error(`La base ${database} ya existe; no se sobrescribe. Usá una instalación vacía.`);}
   for(const [,,database] of suites)await owner.query(`create database "${database}"`);
  }finally{await owner.end();}
 }
 // Serial execution avoids races while bootstrap creates shared cluster roles.
 for(const [name,variable,database] of suites){
  const target=new URL(base);target.pathname=`/${database}`;
  const env={...process.env,[variable]:target.toString()};
  const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',`tests/${name}-concurrency.test.ts`],{env,stdio:'inherit',windowsHide:true});
  if(result.status!==0)failed=true;
 }
}finally{
 if(started&&spawnSync('docker',[...compose,'down','--remove-orphans'],{stdio:'inherit',windowsHide:true}).status!==0)failed=true;
}
if(failed)process.exitCode=1;
