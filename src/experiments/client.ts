import { feishu } from '../client';
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
export type FeishuAuthorizationFlow = {verificationUrl:string;flowId:string;qrDataUrl?:string};
export type FeishuAuthStatus = {pendingAuthorization?:FeishuAuthorizationFlow;connected:boolean;allPermissionsGranted?:boolean;taskConnected?:boolean;calendarConnected?:boolean;calendarMissingScopes?:string[];message:string};
export type FeishuComparisonMetrics = {cases:number;correct:number;falseSelections:number;rejections:number;failures:number;sampleAccuracy:number|null;meanLatencyMs:number|null};
export type FeishuComparisonReport = {executed:boolean;complete:boolean;caseCount:number;summary:{llm:FeishuComparisonMetrics;jev:FeishuComparisonMetrics};limitations:string[]};
export type ExperimentsConfig = {feishuTools?:boolean;feishuRecipientModel?:'llm'|'jev';feishuMessageStyle?:string;pluginShortcuts?:{pluginId:string;purpose?:string;hotkey:string;trigger:string}[]};
export type ExperimentsSnapshot = {config:ExperimentsConfig;recording?:{mode:string;status:string};feishuDraft?:FeishuMessageDraft|null;feishuCatalog?:FeishuCatalog;aiReply?:AiReply|null;aiReplies?:AiReply[]};
export type ExperimentsRequest = {action:string;[key:string]:unknown};

export async function experimentsRequest<T = ExperimentsSnapshot>(request:ExperimentsRequest):Promise<T> {
  const {action,...params}=request;
  if(action==='read') return feishu<T>('feishuWorkspaceRead');
  if(action==='saveConfig') return feishu<T>('feishuWorkspaceSaveConfig',params.config as Record<string,unknown>);
  if(action==='voiceCommandToggle') return feishu<T>('feishuVoiceToggle',{purpose:request.purpose||'message'});
  if(action==='messageVoiceToggle') return feishu<T>('feishuMessageVoiceToggle');
  return feishu<T>(action,params);
}
export type {FeishuMessageDraft,FeishuRecipient};
