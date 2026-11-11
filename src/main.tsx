import {createRoot} from 'react-dom/client';
import {App} from './App';
import {dispose,getClient,getMessageService,getWorkspaceState} from './client';
import {createReportedVoiceWorkflow} from './voice-workflow';
import {createWorkspaceItem} from './workspace-create-service';
import {runWorkspaceVoiceOperation} from './voice-operation-service';
import {confirmVoiceMessage} from './voice-message-confirmation';
import {createPluginMessageDialog} from './plugin-message-dialog';
import './style.css';
const root=createRoot(document.getElementById('root')!);
root.render(<App/>);
const client=getClient();
const confirmMessageDialog=createPluginMessageDialog((method,params,options)=>client.request(method,params,options));
const showMessage=async(draftId:string)=>{
  await client.host.openPlugin();
  window.dispatchEvent(new CustomEvent('feishu-message-draft-ready',{detail:{draftId}}));
};
void client.voice.handle(createReportedVoiceWorkflow({
  diagnostic:entry=>console.info('[feishu-voice-stage]',JSON.stringify(entry)),
  create:createWorkspaceItem,
  progress:(requestId,result)=>client.voice.progress({requestId,result},{timeoutMs:5000}),
  operation:runWorkspaceVoiceOperation,
  prepareMessage:(prompt,signal,attachments)=>getMessageService().prepare({prompt,attachments},{signal}),
  showMessage,
  confirmMessage:(requestId,draft,signal)=>confirmVoiceMessage({
    context:async ()=>{
      const [history,state]=await Promise.all([getWorkspaceState().readHistory(),getWorkspaceState().read()]);
      signal.throwIfAborted();
      return {recipients:state.catalog.recipients,history};
    },
    confirm:input=>confirmMessageDialog(input,signal),
    send:input=>getMessageService().send(input),
    show:showMessage,
  },requestId,draft,signal),
})).catch(error=>{
  window.dispatchEvent(new CustomEvent('feishu-voice-error',{detail:String(error instanceof Error?error.message:error)}));
});
window.addEventListener('pagehide',()=>{root.unmount();dispose();},{once:true});
