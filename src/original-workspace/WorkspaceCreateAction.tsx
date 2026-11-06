import {useEffect,useId,useRef,useState} from "react";
import {ExternalLink,Plus,X} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {experimentsRequest} from "../experiments/client";
import {openFeishuUrl} from "../client";
import {feishuDetailUrl} from "./workspace-receipts";
import "./workspace-create-action.css";

type Kind="task"|"calendar";
type TaskPlan={summary:string;description?:string;recipientQuery?:string;due?:string|null};
type CalendarPlan={summary:string;description?:string;start?:string;end?:string;participantQueries?:string[]};
export type WorkspaceCreateOutcome=
  | {kind:"task";receipt:{guid:string;url:string};plan:TaskPlan}
  | {kind:"calendar";receipt:{eventId:string;calendarId:string;url:string;status?:string;invitationStatus?:string;reason?:string;persistenceWarning?:string};plan:CalendarPlan};
type Props={kind:Kind;onCreated?:(outcome:WorkspaceCreateOutcome)=>void|Promise<void>;disabled?:boolean;className?:string};
function record(value:unknown):Record<string,unknown> {return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function string(value:unknown) {return typeof value==="string"?value:"";}
function outcomeFrom(value:unknown,kind:Kind):WorkspaceCreateOutcome {
  const data=record(value),receipt=record(data.receipt),plan=record(data.plan);
  const common={summary:string(plan.summary),description:string(plan.description)};
  if(kind==="task"&&string(receipt.guid).trim()) return {kind,receipt:{guid:string(receipt.guid),url:string(receipt.url)},plan:{...common,recipientQuery:string(plan.recipientQuery),due:typeof plan.due==="string"?plan.due:null}};
  if(kind==="calendar"&&string(receipt.eventId).trim()&&(!receipt.status||["completed","partial"].includes(string(receipt.status)))) return {kind,receipt:{eventId:string(receipt.eventId),calendarId:string(receipt.calendarId),url:string(receipt.url),status:string(receipt.status),invitationStatus:string(receipt.invitationStatus),reason:string(receipt.reason),persistenceWarning:string(receipt.persistenceWarning)},plan:{...common,start:string(plan.start),end:string(plan.end),participantQueries:Array.isArray(plan.participantQueries)?plan.participantQueries.filter((p):p is string=>typeof p==="string"):undefined}};
  throw Error("未取得完整的飞书创建回执，结果尚未确认。");
}
function requestId() {
  if(typeof crypto.randomUUID==="function") return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(n=>n.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function dateLabel(value:string) {
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(date);
}
/** Published host create calls only. A model plan without a native receipt is never success. */
export function WorkspaceCreateAction({kind,onCreated,disabled=false,className=""}:Props) {
  const [open,setOpen]=useState(false),[prompt,setPrompt]=useState("");
  const [phase,setPhase]=useState<"draft"|"creating"|"receipt"|"error">("draft");
  const [outcome,setOutcome]=useState<WorkspaceCreateOutcome|null>(null);
  const [error,setError]=useState(""),[linkError,setLinkError]=useState(""),[refreshError,setRefreshError]=useState("");
  const pending=useRef(false),mounted=useRef(true),version=useRef(0);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;version.current++;};},[]);
  const id=useId(),label=kind==="task"?"任务":"日程",busy=phase==="creating";
  const text=prompt.trim(),length=[...text].length;
  const url=outcome?feishuDetailUrl(outcome.receipt.url):undefined;
  const close=()=>{if(pending.current)return;setOpen(false);trigger.current?.focus();};
  const freshDraft=()=>{version.current++;setPrompt("");setOutcome(null);setError("");setLinkError("");setRefreshError("");setPhase("draft");};
  async function submit() {

    if(pending.current||phase!=="draft"||disabled||!length||length>500)return;
    const attempt=++version.current;
    pending.current=true;setPhase("creating");setError("");setLinkError("");setRefreshError("");
    try {
      const response=await experimentsRequest<unknown>({action:kind==="task"?"feishuTaskCreate":"feishuCalendarCreate",prompt:text,requestId:requestId()});
      const result=outcomeFrom(response,kind);
      if(!mounted.current||version.current!==attempt)return;
      setOutcome(result);setPhase("receipt");
      // A parent list refresh cannot erase an acknowledged remote creation.
      const refreshFailed=()=>{if(mounted.current&&version.current===attempt)setRefreshError("创建结果已保留，列表刷新未完成，请手动刷新列表。");};
      try {void Promise.resolve(onCreated?.(result)).catch(refreshFailed);} catch {refreshFailed();}
    } catch(failure) {
      if(mounted.current&&version.current===attempt){setError(failure instanceof Error?failure.message:String(failure));setPhase("error");}
    } finally {pending.current=false;}
  }
  return <div className={`feishu-create-action ${className}`}>
    <Button ref={trigger} type="button" variant="outline" disabled={disabled||busy} aria-expanded={open} aria-controls={`${id}-panel`} onClick={()=>open?close():setOpen(true)}>
      <Plus data-icon="inline-start"/>{open?`收起${label}创建`:`创建${label}`}
    </Button>
    {open&&<aside id={`${id}-panel`} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} className="feishu-create-panel" aria-busy={busy} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();close();}}}>
      <header className="feishu-create-header"><div><h2 id={`${id}-title`}>创建{label}</h2><p>描述安排，交给模型整理</p></div><Button type="button" variant="ghost" size="icon-sm" aria-label="关闭创建面板" disabled={busy} onClick={close}><X/></Button></header>
      <div className="feishu-create-body">
      {phase==="draft"||busy?<div className="feishu-create-fields">
        <label htmlFor={`${id}-prompt`}>{label}要求</label>
        <Textarea autoFocus id={`${id}-prompt`} value={prompt} disabled={busy} aria-describedby={`${id}-hint`} aria-invalid={length>500||undefined} onChange={event=>setPrompt(event.target.value)} rows={3} placeholder={kind==="task"?"描述负责人、要做的事和截止时间":"描述要安排的事项、日期时间和参与人"}/>
        <p id={`${id}-hint`} className="feishu-create-hint">用自己的话描述，最多500字。<span>{length}/500</span></p>
        {busy&&<p role="status">正在创建{label}，请等待飞书回执…</p>}
        <div className="feishu-create-actions"><Button type="button" onClick={()=>void submit()} disabled={disabled||busy||!length||length>500}>{busy?"正在创建…":`创建${label}`}</Button><Button type="button" variant="ghost" disabled={busy} onClick={close}>取消</Button></div>
      </div>:outcome?<>
        <p role="status">{outcome.kind==="task"?"任务已创建":"日程已创建"}</p>
        <h3>{outcome.plan.summary||`飞书${label}`}</h3>
        {outcome.plan.description&&<p>{outcome.plan.description}</p>}
        <dl>
          {outcome.kind==="task"?<>
            {outcome.plan.recipientQuery&&<><dt>负责人要求</dt><dd>{outcome.plan.recipientQuery}</dd></>}
            {outcome.plan.due&&<><dt>截止时间</dt><dd>{dateLabel(outcome.plan.due)}{outcome.plan.due.includes("T")?"（北京时间）":""}</dd></>}
          </>:<>
            {outcome.plan.start&&outcome.plan.end&&<><dt>时间</dt><dd>{dateLabel(outcome.plan.start)} 至 {dateLabel(outcome.plan.end)}（北京时间）</dd></>}
            {outcome.plan.participantQueries&&<><dt>参与人要求</dt><dd>{outcome.plan.participantQueries.join("、")||"仅创建人"}</dd></>}
            <dt>邀请回执</dt><dd>{outcome.receipt.reason||"邀请结果未记录，请在飞书核对。"}</dd>
          </>}
        </dl>
        {outcome.kind==="calendar"&&outcome.receipt.persistenceWarning&&<p role="alert">{outcome.receipt.persistenceWarning}</p>}
        <div className="feishu-create-actions">
          {url&&<Button type="button" variant="outline" onClick={()=>{const current=version.current;setLinkError("");void openFeishuUrl(url).catch(()=>{if(mounted.current&&version.current===current)setLinkError("无法打开飞书，请在飞书客户端核对已创建的记录。");});}}><ExternalLink data-icon="inline-start"/>在飞书中查看</Button>}
          <Button type="button" variant="ghost" onClick={freshDraft}>再创建一项</Button>
        </div>
        {!url&&<p>飞书未返回可打开的链接，请在飞书客户端查看。</p>}
      </>:<>
        <div role="alert"><strong>未取得完整创建结果</strong><p>{error}</p></div>
        <p>未自动重试。请先在飞书核对结果，再重新填写其他创建要求。</p>
        <details><summary>本次创建要求</summary><p>{text}</p></details>
        <Button type="button" variant="outline" onClick={freshDraft}>重新填写</Button>
      </>}
      {refreshError&&<p role="alert">{refreshError}</p>}{linkError&&<p role="alert">{linkError}</p>}
      </div>
    </aside>}
  </div>;
}
