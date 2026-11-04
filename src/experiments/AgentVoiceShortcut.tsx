import { useEffect, useRef, useState } from 'react';
import { experimentsRequest, type ExperimentsConfig } from './client';
type Purpose = 'message' | 'task' | 'calendar';
const actions: [Purpose, string][] = [['message','发消息'],['task','创建任务'],['calendar','预约日程']];
const suggestedHotkeys: Record<Purpose, string> = {
  message: 'Ctrl+Alt+F6', task: 'Ctrl+Alt+F7', calendar: 'Ctrl+Alt+F8',
};
export function shortcutFromKey(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code'>) {
  const keys: string[] = [];
  if (event.ctrlKey) keys.push('Ctrl');
  if (event.metaKey) keys.push('Super');
  if (event.altKey) keys.push('Alt');
  if (event.shiftKey) keys.push('Shift');
  const key = event.code === 'Space' ? 'Space' : event.code.startsWith('Key') ? event.code.slice(3) : event.code.startsWith('Digit') ? event.code.slice(5) : /^F([1-9]|1[0-2])$/.test(event.code) ? event.code : '';
  return key && keys.length ? [...keys,key].join('+') : '';
}
export function AgentVoiceShortcut({config,enabled,onToggleEnabled,onSaved}:{config:ExperimentsConfig;enabled:boolean;onToggleEnabled:()=>void;onSaved?:()=>void}) {
  const [listening,setListening]=useState<Purpose|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const lease=useRef(false);
  const pending=useRef(false);
  const captureButton=useRef<HTMLButtonElement|null>(null);
  async function release(){if(lease.current){await experimentsRequest({action:'feishuShortcutCapture',active:false});lease.current=false;}}
  useEffect(()=>()=>{if(lease.current)void release();},[]);
  async function begin(purpose:Purpose){
    if(pending.current||listening)return;
    pending.current=true;
    setBusy(true);setError('');
    try{await experimentsRequest({action:'feishuShortcutCapture',active:true});lease.current=true;setListening(purpose);}
    catch(e){setError(String(e));}finally{pending.current=false;setBusy(false);}
  }
  async function save(purpose:Purpose,hotkey:string){
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');
    let saved=false;
    try{await experimentsRequest({action:'feishuShortcutSet',purpose,hotkey});saved=true;}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{try{await release();setListening(null);if(saved)onSaved?.();}catch(e){setError('快捷键恢复失败：'+String(e));}pending.current=false;setBusy(false);}
  }
  useEffect(()=>{
    if(!listening)return;
    const handle=(event:KeyboardEvent)=>{
      event.preventDefault();event.stopPropagation();
      if(event.repeat||pending.current)return;
      if(event.key==='Escape'){void release().then(()=>setListening(null)).catch(e=>{setError(String(e));setListening(null);});return;}
      if(event.key==='Backspace'){void save(listening,'');return;}
      const value=shortcutFromKey(event);if(value)void save(listening,value);
    };
    window.addEventListener('keydown',handle,true);
    captureButton.current?.focus();
    return ()=>window.removeEventListener('keydown',handle,true);
  },[listening]);
  return <div className="feishu-shortcut-summary"><div className="feishu-shortcut-heading"><div><strong>飞书语音快捷键</strong><p>三个操作分别设置；按一次开始录音，再按一次结束。消息草稿须在浮窗确认。</p></div><button type="button" onClick={onToggleEnabled}>{enabled?'已开启 · 点击关闭':'开启语音发送'}</button></div><div className="feishu-shortcut-list">{actions.map(([purpose,label])=>{
    const entry=config.pluginShortcuts?.find(item=>item.pluginId==='vitalk-plugin-feishu'&&(item.purpose||'message')===purpose);
    return <div key={purpose}><span>{label}</span><button type="button" ref={listening===purpose?captureButton:undefined} disabled={busy||!!listening&&listening!==purpose} aria-label={label+' 唤醒快捷键'} onClick={()=>void begin(purpose)}>{listening===purpose?'按下组合键 · Esc 取消':entry?.hotkey||'自定义快捷键'}</button>{listening===purpose?<button type="button" disabled={busy} onClick={()=>void save(purpose,suggestedHotkeys[purpose])}>使用 {suggestedHotkeys[purpose]}</button>:entry?.hotkey?<button type="button" disabled={busy||!!listening} onClick={()=>void save(purpose,'')} aria-label={'清除'+label+'快捷键'}>清除</button>:<span/>}</div>;
  })}</div>{error&&<p role="alert">{error}</p>}</div>;
}
