import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const apiOrigin=process.env.PAPERCLIP_INTERNAL_API_URL??process.env.PAPERCLIP_API_URL,runId=process.env.PAPERCLIP_RUN_ID,agentId=process.env.PAPERCLIP_AGENT_ID,companyId=process.env.PAPERCLIP_COMPANY_ID,key=process.env.PAPERCLIP_API_KEY;
if(!apiOrigin||!runId||!agentId||!companyId||!key)throw new Error('Use Paperclip process adapter');
if(!['http://127.0.0.1:3100',process.env.PAPERCLIP_PUBLIC_URL].includes(new URL(apiOrigin).origin))throw new Error('Control plane mismatch');
async function api(route,method='GET',body){const r=await fetch(`${apiOrigin}/api${route}`,{method,redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','X-Paperclip-Run-Id':runId},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Paperclip HTTP ${r.status}`);return r.json();}
async function credentials(){const dir='/paperclip/integration-secrets',payload=JSON.parse(await fs.readFile(`${dir}/grok.json`,'utf8')),master=await fs.readFile(`${dir}/master.key`),d=crypto.createDecipheriv('aes-256-gcm',master,Buffer.from(payload.iv,'base64'));d.setAuthTag(Buffer.from(payload.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(payload.data,'base64')),d.final()]).toString('utf8'));}
const root='/paperclip/grok-cloud-jobs';await fs.mkdir(root,{recursive:true,mode:0o700});let issue,job;
const dir=`${root}/${runId}`;
async function save(){await fs.writeFile(`${dir}/job.json.tmp`,JSON.stringify(job),{mode:0o600});await fs.rename(`${dir}/job.json.tmp`,`${dir}/job.json`);}
try{
 const run=await api(`/heartbeat-runs/${runId}`);if(run.agentId!==agentId||run.companyId!==companyId)throw new Error('Run identity mismatch');const c=run.contextSnapshot??{},issueId=c.issueId??c.taskId??c.paperclipWake?.issue?.id;
 if(!issueId){console.log('Assign a task to Grok Bot');process.exit(0);}
 issue=await api(`/issues/${issueId}`);if(issue.companyId!==companyId||issue.assigneeAgentId!==agentId)throw new Error('Assignment mismatch');if(['done','cancelled'].includes(issue.status)){console.log('Task closed');process.exit(0);}
 for(const name of await fs.readdir(root)){const old=await fs.readFile(`${root}/${name}/job.json`,'utf8').then(JSON.parse,()=>null);if(old?.issue.id===issue.id&&['submitted','receipt_unknown'].includes(old.state))throw new Error(`Prior Grok run ${name} requires reconciliation; no duplicate sent`);}
 if(!c.paperclipHarnessCheckedOut)await api(`/issues/${issueId}/checkout`,'POST',{agentId,expectedStatuses:[issue.status]});
 const creds=await credentials(),url=new URL(creds.url);if(url.protocol!=='https:'||!['api2.cursor.sh','api.origin.cursor.com'].includes(url.hostname)||!/^\/automations\/webhook\/[A-Za-z0-9_-]+$/.test(url.pathname))throw new Error('Webhook destination mismatch');
 const token=crypto.randomBytes(32).toString('hex'),jobUrl=`${process.env.PAPERCLIP_PUBLIC_URL}/bot-bridge/jobs/${runId}`;
 job={runId,agentId,companyId,state:'receipt_unknown',deadline:new Date(Date.now()+840000).toISOString(),tokenHash:crypto.createHash('sha256').update(token).digest('hex'),issue:{id:issue.id,identifier:issue.identifier,title:issue.title,description:issue.description??''},instructions:'Work only on this assigned task. Preserve existing approvals. Stop if human input is required. Never contact other people, publish, delete user data, or change live systems without explicit authorization. Return only status (done, blocked, in_review) and summary.',comments:(await api(`/issues/${issue.id}/comments`)).slice(-8).map(x=>({body:x.body}))};
 await fs.mkdir(dir,{recursive:true});await save();
 const r=await fetch(creds.url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${creds.key}`,'Content-Type':'application/json'},body:JSON.stringify({source:'paperclip-vps',runId,issueId:issue.id,jobUrl,jobToken:token,message:'Use the VPS jobUrl and jobToken through your hosted cloud computer. GET the scoped job; perform only that assignment; POST JSON status and summary to the same URL. Do not run any Windows/local helper. Do not reveal the token.'}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error(`Grok webhook HTTP ${r.status}; reconcile before retrying`);await r.body?.cancel();job.state='submitted';await save();console.log(`Grok Cloud webhook accepted for ${issue.identifier}`);
 while(Date.now()<Date.parse(job.deadline)){
  const result=await fs.readFile(`${dir}/result.json`,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return null;throw e;});
  if(result){const latest=await api(`/issues/${issue.id}`);if(latest.companyId!==companyId||latest.assigneeAgentId!==agentId||['done','cancelled'].includes(latest.status))throw new Error('Assignment changed during Grok work');await api(`/issues/${issue.id}`,'PATCH',{status:result.status,comment:`Grok Bot cloud result:\n\n${result.summary}\n\nVPS run: ${runId}`});job.state='completed';await save();console.log(result.summary);process.exit(0);}
  await new Promise(r=>setTimeout(r,2000));
 }
 throw new Error('No cloud result received; reconcile existing Grok run before retrying');
}catch(e){if(issue){const latest=await api(`/issues/${issue.id}`).catch(()=>null);if(latest?.companyId===companyId&&latest?.assigneeAgentId===agentId&&!['done','cancelled'].includes(latest.status))await api(`/issues/${issue.id}`,'PATCH',{status:'blocked',comment:`Grok cloud connection: ${e.message}`}).catch(()=>{});}console.error(e.message);process.exitCode=1;}
