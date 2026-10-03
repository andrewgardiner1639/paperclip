import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('Scoped job rejects wrong/expired tokens and accepts one idempotent result',async()=>{
 const root=await fs.mkdtemp(`${os.tmpdir()}/grok-bridge-`),id=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex'),dir=`${root}/${id}`;await fs.mkdir(dir);
 const job={tokenHash:crypto.createHash('sha256').update(token).digest('hex'),deadline:new Date(Date.now()+60000).toISOString(),issue:{id:crypto.randomUUID(),title:'Fixture'},instructions:'Fixture',comments:[]};await fs.writeFile(`${dir}/job.json`,JSON.stringify(job));
 const p=spawn(process.execPath,[fileURLToPath(new URL('./grok-bridge-server.mjs',import.meta.url))],{env:{...process.env,GROK_BRIDGE_JOBS_ROOT:root,GROK_BRIDGE_PORT:'0'},stdio:['ignore','pipe','pipe']});
 try{
  const port=await new Promise((resolve,reject)=>{let out='';p.stdout.on('data',d=>{out+=d;const m=out.match(/listening (\d+)/);if(m)resolve(m[1]);});p.on('error',reject);p.on('exit',()=>reject(new Error('Test bridge stopped')));});
  const url=`http://127.0.0.1:${port}/bot-bridge/jobs/${id}`,headers={Authorization:`Bearer ${token}`};
  assert.equal((await fetch(url)).status,403);assert.equal((await fetch(url,{headers:{Authorization:'Bearer wrong'}})).status,403);
  const read=await fetch(url,{headers});assert.equal(read.status,200);const context=await read.json();assert.equal(context.issue.id,job.issue.id);assert.equal(context.tokenHash,undefined);
  const submit=body=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await submit({status:'done',summary:''})).status,422);
  assert.equal((await submit({status:'done',summary:'Proof'})).status,200);assert.equal((await submit({status:'done',summary:'Proof'})).status,200);assert.equal((await submit({status:'done',summary:'Changed'})).status,409);
  job.deadline=new Date(Date.now()-1000).toISOString();await fs.writeFile(`${dir}/job.json`,JSON.stringify(job));assert.equal((await fetch(url,{headers})).status,403);
 }finally{p.kill();await fs.rm(root,{recursive:true,force:true});}
});
