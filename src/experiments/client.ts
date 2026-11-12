import { feishu,getClient } from '../client';
import { completeWorkspaceTask,listWorkspaceCalendar,listWorkspaceTasks } from '../workspace-record-service';
import type { FeishuMessageDraft, FeishuRecipient } from '../original-workspace/FeishuMessagePanel';

export type AiReply = {
  id: string; revision?: number; prompt: string; text: string;
  status: 'routing'|'answering'|'completed'|'background'|'failed'|'cancelled';
  error?: string|null;
  command?: { destination:'answer'|'selectionPreview'|'cursorInsert'|'feishuTask'|'feishuMeeting'|'feishuMessage';
    task?: {guid:string;url:string;assignee:string;summary:string;notification?:string|null}|null;
    meeting?: {calendarId:string;eventId:string;url:string;start:string;end:string;participants:string[];invitation:string}|null;
  }|null;
};
export type FeishuCatalog = { searchQuery?:string; recipients:FeishuRecipient[];lastSync:number|null;partial:boolean };
export type FeishuAuthorizationFlow = {stage?:"registration"|"authorization";verificationUrl:string;flowId:string;qrDataUrl?:string};
export type FeishuAuthStatus = {pendingAuthorization?:FeishuAuthorizationFlow;connected:boolean;allPermissionsGranted?:boolean;taskConnected?:boolean;calendarConnected?:boolean;calendarMissingScopes?:string[];message:string};
export type FeishuComparisonMetrics = {cases:number;correct:number;falseSelections:number;rejections:number;failures:number;sampleAccuracy:number|null;meanLatencyMs:number|null};
export type FeishuComparisonReport = {executed:boolean;complete:boolean;caseCount:number;summary:{llm:FeishuComparisonMetrics;jev:FeishuComparisonMetrics};limitations:string[]};
export type ExperimentsConfig = {feishuTools?:boolean;feishuRecipientModel?:'llm'|'jev';feishuMessageStyle?:string;pluginShortcuts?:{pluginId:string;purpose?:string;hotkey:string;trigger:string}[]};
export type ExperimentsSnapshot = {config:ExperimentsConfig;recording?:{mode:string;status:string};feishuDraft?:FeishuMessageDraft|null;feishuCatalog?:FeishuCatalog;aiReply?:AiReply|null;aiReplies?:AiReply[]};
export type VoiceStatus={actionId:string|null;status:string};
export type ExperimentsRequest = {action:string;[key:string]:unknown};

function voiceAction(value:unknown):'message'|'task'|'calendar'{
  const action=value===undefined?'message':value;
  if(action!=='message'&&action!=='task'&&action!=='calendar')throw Error('语音用途无效');
  return action;
}
async function readVoiceShortcuts(){
  const result=await getClient().voice.shortcuts.get();
  return result.shortcuts.filter(item=>['message','task','calendar'].includes(item.actionId||'message'))
    .map(item=>({pluginId:'vitalk-plugin-feishu',purpose:item.actionId||'message',hotkey:item.hotkey,trigger:'toggle'}));
}

// Share only an in-flight snapshot; never cache account checks after settlement.
async function readWorkspaceSnapshot():Promise<ExperimentsSnapshot>{
  try {
    return await feishu<ExperimentsSnapshot>('feishuWorkspaceRead');
  } catch(error) {
    // A read started during voice processing can lose its host lease when voice
    // completes. Recover this display read once, never a send/create mutation.
    if(!error || typeof error!=='object' || !('code' in error) || error.code!=='cancelled')throw error;
    const status=await getClient().voice.status().catch(()=>null);
    if(!status || status.status!=='idle' || status.actionId!==null)throw error;
    return feishu<ExperimentsSnapshot>('feishuWorkspaceRead');
  }
}
let snapshotRead:Promise<ExperimentsSnapshot>|undefined;
export async function experimentsRequest<T = ExperimentsSnapshot>(request:ExperimentsRequest):Promise<T> {
  const {action,...params}=request;
  if(action==='read') {
    snapshotRead??=Promise.all([readWorkspaceSnapshot(),readVoiceShortcuts()])
      .then(([snapshot,pluginShortcuts])=>({...snapshot,config:{...snapshot.config,pluginShortcuts}}))
      .finally(()=>{snapshotRead=undefined;});
    return await snapshotRead as T;
  }
  if(action==='voiceStatus') return await getClient().voice.status() as T;
  if(action==='saveConfig') return feishu<T>('feishuWorkspaceSaveConfig',params.config as Record<string,unknown>);
  if(action==='voiceCommandToggle'||action==='messageVoiceToggle') return await getClient().voice.toggle({actionId:voiceAction(action==='messageVoiceToggle'?'message':request.purpose)}) as T;
  if(action==='feishuShortcutSet') {
    if(typeof request.hotkey!=='string')throw Error('快捷键无效');
    await getClient().voice.shortcuts.set({actionId:voiceAction(request.purpose),hotkey:request.hotkey});
    return {config:{pluginShortcuts:await readVoiceShortcuts()}} as T;
  }
  if(action==='feishuShortcutCapture') {
    if(typeof request.active!=='boolean')throw Error('快捷键录入状态无效');
    return await getClient().voice.shortcuts.capture({active:request.active}) as T;
  }
  if(action==='feishuTaskList') return await listWorkspaceTasks(params) as T;
  if(action==='feishuTaskComplete') return await completeWorkspaceTask(params) as T;
  if(action==='feishuCalendarList') return await listWorkspaceCalendar(params) as T;
  return feishu<T>(action,params);
}
export type {FeishuMessageDraft,FeishuRecipient};
