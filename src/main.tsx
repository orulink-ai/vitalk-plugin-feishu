import {createRoot} from 'react-dom/client';
import {App} from './App';
import {dispose,getClient,getMessageService} from './client';
import {createVoiceWorkflow} from './voice-workflow';
import {createWorkspaceItem} from './workspace-create-service';
import {runWorkspaceVoiceOperation} from './voice-operation-service';
import './style.css';
const root=createRoot(document.getElementById('root')!);
root.render(<App/>);
const client=getClient();
void client.voice.handle(createVoiceWorkflow({
  create:createWorkspaceItem,
  progress:(requestId,result)=>client.voice.progress({requestId,result},{timeoutMs:5000}),
  operation:runWorkspaceVoiceOperation,
  prepareMessage:(prompt,signal,attachments)=>getMessageService().prepare({prompt,attachments},{signal}),
  showMessage:async draftId=>{
    await client.host.openPlugin();
    window.dispatchEvent(new CustomEvent('feishu-message-draft-ready',{detail:{draftId}}));
  },
})).catch(error=>{
  window.dispatchEvent(new CustomEvent('feishu-voice-error',{detail:String(error instanceof Error?error.message:error)}));
});
window.addEventListener('pagehide',()=>{root.unmount();dispose();},{once:true});
