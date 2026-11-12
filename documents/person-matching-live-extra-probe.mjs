import {registerHooks} from 'node:module';import{existsSync,readFileSync,writeFileSync}from'node:fs';import{fileURLToPath}from'node:url';
registerHooks({resolve(spec,context,next){if(spec.startsWith('.')&&!/\.[a-z]+$/i.test(spec)){const candidate=new URL(spec+'.ts',context.parentURL);if(existsSync(fileURLToPath(candidate)))return next(candidate.href,context);}return next(spec,context);}});
const {prepareTask}=await import('../src/task-intent.ts');const {prepareMessage}=await import('../src/message-intent.ts');const{prepareCalendar}=await import('../src/calendar-intent.ts');const{personContext}=await import('../src/person-context.ts');
const catalog=JSON.parse(readFileSync('D:/Project/Vi/_logs/task-name-sync-catalog.json','utf8'));const self='ou_42fc5106fd5ca948b6a792f461193a65';
if(!catalog.people.length||catalog.people.some(p=>!p.active||p.external))throw Error('Live contact snapshot is incomplete');
const people=personContext(catalog.people,self,[{query:'验收称呼',recipientId:self}]);
const pages=await(await fetch('http://127.0.0.1:9237/json/list')).json();let ws,id=0;const pending=new Map();
function call(method,params){return new Promise((ok,no)=>{const next=++id;const timer=setTimeout(()=>no(Error('CDP timeout')),120000);pending.set(next,{ok,no,timer});ws.send(JSON.stringify({id:next,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
for(const page of pages){ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(ok=>ws.addEventListener('open',ok,{once:true}));ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(JSON.stringify(m.error))):p.ok(m.result);}});if(await evaluate('window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label')==='main')break;ws.close();}
let requests=0;const model=async(input,instructions)=>{requests++;const request={messages:[{role:'system',content:instructions},{role:'user',content:JSON.stringify(input)}],maxOutputTokens:4096};const response=await evaluate(`window.__TAURI_INTERNALS__.invoke('plugin_ai_generate',{request:${JSON.stringify(request)}})`);return JSON.parse(response.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1'));};
const ref=new Date().toISOString();const rows=[];
try{
 for(const [kind,source] of [['message','告诉全部人明天下午三点交周报'],['task','给全部人创建一条共同负责的任务，明天下午三点前交周报'],['calendar','明天下午三点邀请全部人一起讨论周报半小时']]){
  const result=kind==='message'?await prepareMessage(source,people.map(p=>({...p,kind:'person'})),model,''):kind==='task'?await prepareTask(source,people,ref,model):await prepareCalendar(source,people,ref,model);
  const ids=kind==='message'?result.recipientIds:kind==='task'?result.assigneeIds:result.participantIds;
  if(ids?.length!==catalog.people.length||ids.some(id=>!catalog.people.some(p=>p.id===id)))throw Error('All-contact set mismatch '+kind);
  rows.push({kind,case:'allContacts',passed:true,count:ids.length,groups:0});console.log(JSON.stringify(rows.at(-1)));
 }
 for(const [kind,source] of [['message','给验收称呼发条消息，内容是匹配验收'],['task','给我自己创建一个任务，让我等会检查资料'],['calendar','明天下午三点帮我自己留半小时检查资料']]){
  const result=kind==='message'?await prepareMessage(source,people.map(p=>({...p,kind:'person'})),model,''):kind==='task'?await prepareTask(source,people,ref,model):await prepareCalendar(source,people,ref,model);
  const ids=kind==='message'?[result.recipient?.id]:kind==='task'?[result.assigneeId]:result.participantIds;
  if(!(kind==='calendar'&&result.participantScope==='personal'&&ids.length===0)&&(ids?.length!==1||ids[0]!==self))throw Error('Self/alias mismatch '+kind);
  rows.push({kind,case:kind==='message'?'self':'confirmedAlias',passed:true,count:1});console.log(JSON.stringify(rows.at(-1)));
 }
 writeFileSync('D:/Project/Vi/_logs/unified-person-live-matching-extra.json',JSON.stringify({remoteModel:true,nativeWrites:0,requests,rows},null,2));
}finally{ws.close();}
