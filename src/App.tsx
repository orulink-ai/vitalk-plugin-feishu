import {useEffect,useState} from 'react';
import {feishu} from './client';

type Auth={connected:boolean;allPermissionsGranted?:boolean;taskConnected?:boolean;calendarConnected?:boolean;message:string;pendingAuthorization?:{verificationUrl:string;flowId:string;qrDataUrl?:string}};
type Recipient={id:string;name:string;kind:string};
type Draft={id:string;status:string;content:string;recipient?:Recipient;recipientCandidates?:Recipient[];error?:string;receipt?:string};
type Task={id:string;title:string;completed:boolean;dueTimestamp?:string};
type TaskPage={items:Task[];accountId:string;hasMore:boolean;nextPageToken:string};
type Event={id:string;summary?:string;start?:{timestamp?:string;date?:string};end?:{timestamp?:string;date?:string}};
const message=(e:unknown)=>e instanceof Error?e.message:String(e);

export function App(){
  const [tab,setTab]=useState<'message'|'tasks'|'calendar'>('message');
  const [auth,setAuth]=useState<Auth>();
  const [prompt,setPrompt]=useState('');
  const [draft,setDraft]=useState<Draft|null>(null);
  const [recipient,setRecipient]=useState('');
  const [content,setContent]=useState('');
  const [tasks,setTasks]=useState<TaskPage>();
  const [events,setEvents]=useState<Event[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();}catch(e){setError(message(e));}finally{setBusy(false);}}
  async function refreshAuth(){setAuth(await feishu<Auth>('feishuAuthStatus'));}
  useEffect(()=>{void refreshAuth().catch(e=>setError(message(e)));},[]);
  useEffect(()=>{
    if(tab==='tasks'&&auth?.taskConnected)void feishu<TaskPage>('feishuTaskList').then(setTasks).catch(e=>setError(message(e)));
    if(tab==='calendar'&&auth?.calendarConnected)void loadCalendar().catch(e=>setError(message(e)));
  },[tab,auth?.taskConnected,auth?.calendarConnected]);
  async function loadCalendar(){const now=Math.floor(Date.now()/1000);const result=await feishu<{items:Event[]}>('feishuCalendarList',{start:now-86400,end:now+30*86400});setEvents(result.items);}
  async function authorize(){const flow=await feishu<Auth['pendingAuthorization']>('feishuAuthStart');if(!flow)throw Error('未获得授权链接');setAuth(current=>({...current,connected:false,message:'请在浏览器中完成飞书授权',pendingAuthorization:flow}));}
  async function completeAuth(){if(!auth?.pendingAuthorization)throw Error('请先开始授权');await feishu('feishuAuthComplete',{flowId:auth.pendingAuthorization.flowId});await refreshAuth();}
  async function prepare(){const next=await feishu<Draft|null>('feishuPrepare',{prompt});if(!next)throw Error('请说明发送对象和消息内容');setDraft(next);setContent(next.content||'');setRecipient(next.recipient?.id||'');}
  async function send(){if(!draft)throw Error('草稿不存在');if(!recipient||!content.trim())throw Error('请选择收件人并填写内容');const next=await feishu<Draft>('feishuSend',{id:draft.id,recipientId:recipient,content});setDraft(next);setStatus(next.status==='sent'?'消息已发送':next.error||'发送结果待核实，请勿重复发送');}
  async function completeTask(task:Task){if(!tasks?.accountId)throw Error('任务账号缺失');await feishu('feishuTaskComplete',{id:task.id,accountId:tasks.accountId});setTasks(await feishu<TaskPage>('feishuTaskList'));}
  return <main>
    <header><h1>飞书</h1><p>语音快捷键在 ViTalk 的插件设置中独立配置。消息发送前需确认。</p></header>
    <section className="card"><h2>连接状态</h2><p>{auth?.message||'正在查询…'}</p>
      {(!auth?.connected||auth.allPermissionsGranted===false)&&<div className="actions"><button disabled={busy} onClick={()=>void run(authorize)}>{auth?.connected?"补齐飞书授权":"连接飞书"}</button>{auth?.pendingAuthorization&&<><p>请用手机扫描二维码完成授权；也可复制下方链接到浏览器。</p>{auth.pendingAuthorization.qrDataUrl&&<img width="180" height="180" alt="飞书授权二维码" src={auth.pendingAuthorization.qrDataUrl}/>}<code>{auth.pendingAuthorization.verificationUrl}</code><button disabled={busy} onClick={()=>void run(completeAuth)}>已完成授权</button></>}</div>}
      <button disabled={busy} onClick={()=>void run(refreshAuth)}>刷新状态</button>
    </section>
    <nav aria-label="飞书功能"><button aria-current={tab==='message'} onClick={()=>setTab('message')}>消息</button><button aria-current={tab==='tasks'} onClick={()=>setTab('tasks')}>任务</button><button aria-current={tab==='calendar'} onClick={()=>setTab('calendar')}>日程</button></nav>
    {error&&<p role="alert" className="error">{error}</p>}{status&&<p role="status">{status}</p>}
    {tab==='message'&&<section className="card"><h2>准备消息</h2><label>给谁发什么消息？<textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="例如：给小林发消息，问他明天几点到"/></label><button disabled={busy||!prompt.trim()||!auth?.connected} onClick={()=>void run(prepare)}>生成草稿</button>
      {draft&&<div className="draft"><h3>确认发送</h3><p>状态：{draft.status}</p><label>收件人<select value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">请选择</option>{[...(draft.recipient?[draft.recipient]:[]),...(draft.recipientCandidates||[])].filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i).map(r=><option key={r.id} value={r.id}>{r.name}（{r.kind}）</option>)}</select></label><label>内容<textarea value={content} onChange={e=>setContent(e.target.value)}/></label><button disabled={busy||draft.status==='sent'||draft.status==='sending'||draft.status==='unknown'} onClick={()=>void run(send)}>确认发送</button>{draft.receipt&&<p>回执：{draft.receipt}</p>}{draft.error&&<p role="alert">{draft.error}</p>}</div>}
    </section>}
    {tab==='tasks'&&<section className="card"><h2>飞书任务</h2><button disabled={busy||!auth?.taskConnected} onClick={()=>void run(async()=>setTasks(await feishu<TaskPage>('feishuTaskList')))}>刷新任务</button><ul>{tasks?.items.map(task=><li key={task.id}><span>{task.title}</span><span>{task.completed?'已完成':task.dueTimestamp||''}</span>{!task.completed&&<button disabled={busy} onClick={()=>void run(()=>completeTask(task))}>完成</button>}</li>)}</ul>{tasks?.hasMore&&<button disabled={busy} onClick={()=>void run(async()=>{const next=await feishu<TaskPage>('feishuTaskList',{pageToken:tasks.nextPageToken});setTasks({...next,items:[...tasks.items,...next.items]});})}>加载更多</button>}</section>}
    {tab==='calendar'&&<section className="card"><h2>未来 30 天日程</h2><button disabled={busy||!auth?.calendarConnected} onClick={()=>void run(loadCalendar)}>刷新日程</button><ul>{events.map(event=><li key={event.id}><span>{event.summary||'未命名日程'}</span><span>{event.start?.date||event.start?.timestamp||''}</span></li>)}</ul></section>}
  </main>;
}
