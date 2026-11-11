import {useEffect,useState} from 'react';
import {History,X} from 'lucide-react';
import {FeishuMessagePanel,type FeishuMessageDraft,type FeishuRecipient} from './original-workspace/FeishuMessagePanel';
import type {AiReply} from './experiments/client';
import {FeishuActivityPanel} from './original-workspace/FeishuActivityPanel';

export type FloatingInput={draftId:string;recipientId:string;content:string;recipients:FeishuRecipient[];attachments?:FeishuMessageDraft['attachments'];history?:AiReply[];historyOnly?:boolean};
export function FloatingMessageWindow({input,decide,drag,resize}:{input:FloatingInput;decide:(value:unknown)=>void;drag?:()=>void;resize?:(layout:'message'|'message-long'|'message-attachments'|'history')=>void}){
 const [draft,setDraft]=useState<FeishuMessageDraft>(()=>({id:input.draftId,prompt:'',content:input.content,status:'ready',recipient:input.recipients.find(r=>r.id===input.recipientId),attachments:input.attachments}));
 const [history,setHistory]=useState(input.historyOnly===true);
 const [picker,setPicker]=useState(false);
 useEffect(()=>{resize?.(history?'history':picker||draft.content.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(Array.from(line).length/24)),0)>3?'message-long':draft.attachments?.length?'message-attachments':'message');},[history,picker,draft.content,draft.attachments,resize]);
 const close=()=>decide({confirmed:false});
 return <main className={`experiment-notice-window${history?'':' experiment-notice-message'}`}>
  <header className="experiment-notice-header" onMouseDown={e=>{if(e.button===0&&!(e.target as HTMLElement).closest('button'))drag?.();}}>
   <strong className="experiment-notice-title">{history?'历史记录':'消息待确认'}</strong>
   <div className="floating-window-actions">{!input.historyOnly&&<button aria-label={history?'返回消息':'历史记录'} onClick={()=>setHistory(!history)}><History size={16}/></button>}<button aria-label="关闭通知" onClick={close}><X size={18}/></button></div>
  </header>
  <div className="experiment-notice-body">{history?<FeishuActivityPanel replies={input.history??[]} onOpenUrl={async url=>decide({action:'open',url})}/>:<FeishuMessagePanel draft={draft} recipients={input.recipients} onPickerChange={setPicker} onChange={change=>setDraft(current=>({...current,...change}))} onClose={close} sendLabel="确认发送" onSend={()=>{if(draft.recipient&&draft.content.trim())decide({confirmed:true,draftId:input.draftId,recipientId:draft.recipient.id,content:draft.content,attachmentIds:draft.attachments?.map(a=>a.id)});}}/>}</div>
 </main>;
}
