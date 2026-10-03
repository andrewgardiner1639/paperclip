import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const root=process.env.GROK_BRIDGE_JOBS_ROOT??'/paperclip/grok-cloud-jobs';await fs.mkdir(root,{recursive:true,mode:0o700});
export function validResult(value){return value&&['done','blocked','in_review'].includes(value.status)&&typeof value.summary==='string'&&value.summary.trim().length>0&&value.summary.length<=25000;}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 try{
  const match=new URL(req.url,'http://bridge').pathname.match(/^\/bot-bridge\/jobs\/([a-f0-9-]{36})$/);
  if(!match){res.writeHead(404).end('{}');return;}
  const id=match[1],dir=`${root}/${id}`,job=JSON.parse(await fs.readFile(`${dir}/job.json`,'utf8'));
  const token=req.headers.authorization?.replace(/^Bearer /,'')??'',digest=crypto.createHash('sha256').update(token).digest('hex');
  if(!token||digest.length!==job.tokenHash.length||!crypto.timingSafeEqual(Buffer.from(digest),Buffer.from(job.tokenHash))||Date.now()>Date.parse(job.deadline)){res.writeHead(403).end('{}');return;}
  if(req.method==='GET'){
   await fs.writeFile(`${dir}/claimed.json`,JSON.stringify({at:new Date().toISOString()}),{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});
   res.end(JSON.stringify({runId:id,issue:job.issue,instructions:job.instructions,comments:job.comments}));return;
  }
  if(req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>35000){res.writeHead(413).end('{}');return;}}
   const value=JSON.parse(body);if(!validResult(value)){res.writeHead(422).end('{}');return;}
   const output=JSON.stringify({runId:id,issueId:job.issue.id,status:value.status,summary:value.summary});
   try{await fs.writeFile(`${dir}/result.json`,output,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const old=JSON.parse(await fs.readFile(`${dir}/result.json`,'utf8'));if(old.status!==value.status||old.summary!==value.summary){res.writeHead(409).end('{}');return;}}
   res.end('{"accepted":true}');return;
  }
  res.writeHead(405).end('{}');
 }catch(e){res.writeHead(e.code==='ENOENT'?404:400).end('{}');}
});
server.listen(Number(process.env.GROK_BRIDGE_PORT??3020),'0.0.0.0',()=>console.log(`Scoped Grok result bridge listening ${server.address().port}`));
