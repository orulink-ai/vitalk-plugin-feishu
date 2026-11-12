import type {createPluginClient,JsonValue} from '@vitalk/plugin-sdk';
import type {CliAuthStatus} from './cli-auth';
import type {ExperimentsConfig,FeishuCatalog,AiReply} from './experiments/client';
type Request=ReturnType<typeof createPluginClient>['request'];
type Entry={query:string;recipientId:string;source:'manual'|'confirmed-send'};
const historyQueues=new Map<string,Promise<unknown>>();
type State={accountId:string;config:ExperimentsConfig;catalog:FeishuCatalog;enabled:boolean;entries:Entry[];legacyHistory?:AiReply[]};
const object=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
export function createWorkspaceStateService(request:Request,readAccount:()=>Promise<CliAuthStatus>){
 let pending:Promise<State>|undefined;
 const write=async(s:State)=>{if((await request('storage.set',{key:`workspace.${s.accountId}`,value:s as unknown as JsonValue})).ok!==true)throw Error('飞书插件设置保存失败');};
 async function read(verifiedAccount?:CliAuthStatus):Promise<State>{
  const account=verifiedAccount??await readAccount();const saved=(await request('storage.get',{key:`workspace.${account.accountId}`})).value;
  if(saved){const s=saved as unknown as State;if(s.accountId!==account.accountId||!Array.isArray(s.entries)||!Array.isArray(s.catalog?.recipients))throw Error('飞书插件设置格式无效，原数据已保留');return s;}
  if(pending){await pending;return read();}
  pending=(async()=>{
   let legacy:Record<string,any>={},memory:Record<string,any>={};
   try{
    legacy=object(await request('feishu.request',{action:'feishuWorkspaceRead',params:{}}));
    memory=object(await request('feishu.request',{action:'feishuRecipientMemory',params:{operation:'list'}}));
   }catch(error){
    // An absent migration capability is not a failed live Feishu operation.
    // Preserve actual permission, transport and storage failures for recovery.
    if(object(error).code!=='unsupported_method')throw error;
   }
   if((await readAccount()).accountId!==account.accountId)throw Error('迁移时飞书账号已变化');
   // Preserve the unmodified export; never reactivate a legacy send draft.
   if((await request('storage.set',{key:`legacy-workspace-backup.${account.accountId}`,value:{legacy,memory} as JsonValue})).ok!==true)throw Error('飞书历史设置备份失败');
   const same=memory.accountId===account.accountId;
   const config=same?object(legacy.config):{};
   const s:State={legacyHistory:same&&Array.isArray(legacy.aiReplies)?legacy.aiReplies:[],accountId:account.accountId,config:{feishuTools:config.feishuTools!==false,feishuRecipientModel:'llm',feishuMessageStyle:typeof config.feishuMessageStyle==='string'?config.feishuMessageStyle:'',pluginShortcuts:[]},catalog:same&&Array.isArray(legacy.feishuCatalog?.recipients)?legacy.feishuCatalog:{recipients:[],partial:true,lastSync:null},enabled:same&&memory.enabled===true,entries:same&&Array.isArray(memory.entries)?memory.entries.filter((e:any)=>typeof e.query==='string'&&typeof e.recipientId==='string').map((e:any)=>({query:e.query,recipientId:e.recipientId,source:e.source==='confirmed-send'?'confirmed-send':'manual'})):[]};
   await write(s);return s;
  })();try{return await pending;}finally{pending=undefined;}
 }
 async function readHistory(verifiedAccount?:CliAuthStatus):Promise<AiReply[]>{const s=await read(verifiedAccount);const value=(await request('storage.get',{key:`workspace-history.${s.accountId}`})).value;const records=Array.isArray(value)?value as unknown as AiReply[]:[];return [...records,...(s.legacyHistory??[]).filter(r=>!records.some(n=>n.id===r.id))];}
 return {read:()=>read(),readHistory:()=>readHistory(),
  async readAliases(expectedAccountId?:string){if(expectedAccountId&&(await readAccount()).accountId!==expectedAccountId)throw Error('飞书账号已变化');const s=await read();if(expectedAccountId&&(s.accountId!==expectedAccountId||(await readAccount()).accountId!==expectedAccountId))throw Error('飞书账号已变化');return s.entries.map(e=>({query:e.query,recipientId:e.recipientId}));},
  async appendHistory(record:AiReply,expectedAccountId?:string){if(!record.id||typeof record.prompt!=='string'||typeof record.text!=='string')throw Error('操作记录无效');const verifiedAccount=await readAccount();const account=verifiedAccount.accountId;if(expectedAccountId&&account!==expectedAccountId)throw Error('飞书账号已变化');const previous=historyQueues.get(account)??Promise.resolve();const next=previous.catch(()=>{}).then(async()=>{const records=await readHistory(verifiedAccount);if((await readAccount()).accountId!==account)throw Error('飞书账号已变化');const result=await request('storage.set',{key:`workspace-history.${account}`,value:[record,...records.filter(r=>r.id!==record.id)] as unknown as JsonValue});if(result.ok!==true)throw Error('操作记录保存失败');});historyQueues.set(account,next);try{await next;}finally{if(historyQueues.get(account)===next)historyQueues.delete(account);}},
  async saveConfig(p:Record<string,unknown>){const s=await read();if('feishuTools'in p){if(typeof p.feishuTools!=='boolean')throw Error('开关无效');s.config.feishuTools=p.feishuTools;}if('feishuMessageStyle'in p){if(typeof p.feishuMessageStyle!=='string'||p.feishuMessageStyle.length>2000)throw Error('消息风格无效');s.config.feishuMessageStyle=p.feishuMessageStyle;}s.config.feishuRecipientModel='llm';await write(s);return s;},
  async saveCatalog(catalog:FeishuCatalog,expectedAccountId?:string){if(expectedAccountId&&(await readAccount()).accountId!==expectedAccountId)throw Error('飞书账号已变化');const s=await read();if(expectedAccountId&&(s.accountId!==expectedAccountId||(await readAccount()).accountId!==expectedAccountId))throw Error('飞书账号已变化');s.catalog=catalog;await write(s);return catalog;},
  async memory(p:Record<string,unknown>){const s=await read();const operation=p.operation??'list';if(operation==='configure'){if(typeof p.enabled!=='boolean')throw Error('学习开关无效');s.enabled=p.enabled;}else if(operation==='save'||operation==='delete'){const query=typeof p.query==='string'?p.query.trim().toLowerCase():'';if(!query||query.length>50)throw Error('请输入1至50字的对象称呼');if(operation==='save'){if(!s.catalog.recipients.some(r=>r.id===p.recipientId))throw Error('请选择真实对象');s.entries=s.entries.filter(e=>e.query!==query);s.entries.push({query,recipientId:String(p.recipientId),source:'manual'});}else s.entries=s.entries.filter(e=>e.query!==query);}else if(operation!=='list')throw Error('未知对象记忆操作');if(operation!=='list')await write(s);return {connected:true,enabled:s.enabled,entries:s.entries.map(e=>({...e,name:s.catalog.recipients.find(r=>r.id===e.recipientId)?.name,active:s.catalog.recipients.some(r=>r.id===e.recipientId)})),pending:[]};}
 };
}
