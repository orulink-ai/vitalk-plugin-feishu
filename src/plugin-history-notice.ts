import {getClient,getWorkspaceState} from './client';
import {noticeRecords} from './message-notice';
let pending:Promise<void>|undefined;
export function openPluginHistory():Promise<void>{
 if(pending)return pending;
 pending=(async()=>{const history=await getWorkspaceState().readHistory();await getClient().notice.present({title:'历史记录',fields:[],records:noticeRecords(history)});})().finally(()=>{pending=undefined;});
 return pending;
}
