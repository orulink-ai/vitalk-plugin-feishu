import {getClient,getWorkspaceState} from './client';
import {createPluginMessageDialog} from './plugin-message-dialog';
let pending:Promise<void>|undefined;
/** The workspace opens the same plugin-owned window; history never sends. */
export function openPluginHistory():Promise<void>{
 if(pending)return pending;
 pending=(async()=>{
  const history=await getWorkspaceState().readHistory();
  try{
   await createPluginMessageDialog((m,p,o)=>getClient().request(m,p,o))({requestId:crypto.randomUUID(),history,historyOnly:true,draft:{draftId:'history-only',recipientId:'',content:'',recipients:[]}});
  }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))throw error;}
 })().finally(()=>{pending=undefined;});
 return pending;
}
