import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const origin=process.env.PAPERCLIP_INTERNAL_API_URL??process.env.PAPERCLIP_API_URL,runId=process.env.PAPERCLIP_RUN_ID,agentId=process.env.PAPERCLIP_AGENT_ID,companyId=process.env.PAPERCLIP_COMPANY_ID,key=process.env.PAPERCLIP_API_KEY;
if(!origin||!runId||!agentId||!companyId||!key)throw new Error('Use the Paperclip process adapter');
if(!process.env.CODEX_CLOUD_ENV_ID)throw new Error('Configure CODEX_CLOUD_ENV_ID for the approved repository environment');
const url=new URL(origin);if(!((['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='3100')||(url.origin===process.env.PAPERCLIP_PUBLIC_URL)))throw new Error('Unexpected control plane');
const root='/paperclip/cloud-jobs';await fs.mkdir(root,{recursive:true});
async function api(route,method='GET',body){const r=await fetch(`${origin}/api${route}`,{method,redirect:'error',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','X-Paperclip-Run-Id':runId},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Paperclip returned HTTP ${r.status}`);return r.json();}
function cli(args,input){return new Promise((resolve,reject)=>{const p=spawn('codex',['cloud',...args],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));p.stdin.end(input??'');});}
async function details(id){
 await cli(['status',id]); // CLI owns subscription token renewal.
 const auth=JSON.parse(await fs.readFile('/paperclip/.codex/auth.json','utf8'));
 const r=await fetch(`https://chatgpt.com/backend-api/wham/tasks/${id}`,{redirect:'error',headers:{Authorization:`Bearer ${auth.tokens.access_token}`,'ChatGPT-Account-Id':auth.tokens.account_id,'User-Agent':'codex_cli_rs/0.160.0'},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error(`Cloud status returned HTTP ${r.status}; reconcile the existing cloud task`);return r.json();
}
let job,file,issue;
async function save(){await fs.writeFile(`${file}.tmp`,JSON.stringify(job,null,2),{mode:0o600});await fs.rename(`${file}.tmp`,file);}
try{
 const run=await api(`/heartbeat-runs/${runId}`);if(run.companyId!==companyId||run.agentId!==agentId)throw new Error('Run identity mismatch');
 const c=run.contextSnapshot??{},id=c.issueId??c.taskId??c.paperclipWake?.issue?.id;
 if(!id){console.log('Assign a task to Codex to start a cloud run');process.exit(0);}
 issue=await api(`/issues/${id}`);if(issue.companyId!==companyId||issue.assigneeAgentId!==agentId)throw new Error('Task assignment mismatch');if(['done','cancelled'].includes(issue.status)){console.log('Task already closed');process.exit(0);}
 file=path.join(root,`${issue.id}.json`);job=await fs.readFile(file,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return null;throw e;});
 if(job?.state==='receipt_unknown'&&!job.taskId)throw new Error('Previous cloud submission has unknown receipt; manual reconciliation required');
 if(!c.paperclipHarnessCheckedOut)await api(`/issues/${issue.id}/checkout`,'POST',{agentId,expectedStatuses:[issue.status]});
 if(!job||job.state==='completed'){
  const comments=await api(`/issues/${issue.id}/comments`);
  const instruction=await fs.readFile(process.env.CODEX_CLOUD_INSTRUCTIONS_FILE??'/integrations/agents/codex/AGENTS.md','utf8').catch(()=> '');
  const documentList=await api(`/issues/${issue.id}/documents`);
  const documentRows=Array.isArray(documentList)?documentList:documentList.documents??[];
  const documents=[];for(const doc of documentRows.slice(0,8)){if(doc.key==='cloud-result')continue;const full=await api(`/issues/${issue.id}/documents/${encodeURIComponent(doc.key)}`);documents.push({title:full.title??doc.title,body:(full.body??full.content??'').slice(0,20000)});}
  const prompt=[`You are Codex working for the user through Paperclip. Task ${issue.identifier}: ${issue.title}`, 'Work only on this assignment. Existing human approvals still apply. Do not publish, send messages to other people, delete user data, or change live systems without explicit authorization. Do not access the Paperclip API or request credentials. The dispatcher will post your result. Local Windows files and desktop apps are unavailable. Explain a blocker instead of pretending those tools are available.',instruction,issue.description??'',JSON.stringify(documents),JSON.stringify((Array.isArray(comments)?comments:comments.comments??[]).slice(-8).map(x=>({body:x.body}))), 'Finish with a JSON object containing status (done, blocked, or in_review) and summary. Only mark done when the entire assigned work has been verified.'].join('\n\n');
  job={issueId:issue.id,runId,agentId,companyId,state:'receipt_unknown',createdAt:new Date().toISOString()};await save();
  const receipt=await cli(['exec','--env',process.env.CODEX_CLOUD_ENV_ID,'--branch',process.env.CODEX_CLOUD_BRANCH??'master','--attempts','1','-'],prompt);
  const match=receipt.stdout.match(/task_[A-Za-z0-9_]+/);if(receipt.code!==0||!match)throw new Error('Cloud submission receipt uncertain; no automatic retry was sent');
  job.taskId=match[0];job.url=`https://chatgpt.com/remote/${job.taskId}`;job.state='submitted';await save();
  await api(`/issues/${issue.id}/comments`,'POST',{body:`Codex Cloud started: ${job.url}\n\nExecution is hosted by OpenAI. The current CLI cloud service chooses its model; this connection does not enforce the previous local GPT-6.1 Sol setting.`});
 }
 console.log(`Following cloud task ${job.taskId}`);
 const deadline=Date.now()+3300000;
 while(Date.now()<deadline){
  const task=await details(job.taskId),turn=task.current_assistant_turn;
  if(['completed','failed','cancelled','canceled'].includes(turn?.turn_status)){
   const text=(turn.output_items??[]).filter(x=>x.type==='message'&&x.role==='assistant').flatMap(x=>x.content??[]).filter(x=>x.content_type==='text').map(x=>x.text).join('\n');
   let result;try{result=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{result={status:'in_review',summary:text};}
   if(turn.turn_status!=='completed'||!result.summary)throw new Error(`Cloud task ended ${turn.turn_status}; review ${job.url}`);
   if(!['done','blocked','in_review'].includes(result.status))result.status='in_review';
   const latest=await api(`/issues/${issue.id}`);if(latest.assigneeAgentId!==agentId||latest.companyId!==companyId||['done','cancelled'].includes(latest.status))throw new Error('Task reassigned or closed during cloud work');
   const comment=`Codex Cloud result (${turn.model_version??'model unavailable'}):\n\n${result.summary}\n\nCloud history: ${job.url}`;
   await api(`/issues/${issue.id}`,'PATCH',{status:result.status,comment});
   job.state='completed';job.model=turn.model_version;job.result=result;job.finishedAt=new Date().toISOString();await save();console.log(comment);process.exit(0);
  }
  await new Promise(r=>setTimeout(r,15000));
 }
 throw new Error(`Cloud task is still pending; resume the same task ${job.url}, do not resubmit`);
}catch(e){if(issue){const latest=await api(`/issues/${issue.id}`).catch(()=>null);if(latest?.companyId===companyId&&latest?.assigneeAgentId===agentId&&!['done','cancelled'].includes(latest.status))await api(`/issues/${issue.id}`,'PATCH',{status:'blocked',comment:`Codex Cloud connection: ${e.message}`}).catch(()=>{});}console.error(e.message);process.exitCode=1;}
