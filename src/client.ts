import {createPluginClient,createWindowTransport} from '@vitalk/plugin-sdk';
let client: ReturnType<typeof createPluginClient> | undefined;
export function getClient(){
  if(!client){
    const token=(window as Window & {__VITALK_PLUGIN_TOKEN__?:string}).__VITALK_PLUGIN_TOKEN__;
    if(!token) throw Error('请从 ViTalk 插件商店打开飞书。');
    client=createPluginClient(createWindowTransport(token));
  }
  return client;
}
export async function feishu<T>(action:string,params:Record<string,unknown>={}):Promise<T>{
  // Native install can take 180s; device authorization can wait 600s,
  // followed by a 30s status read. Keep the SDK waiter alive for the receipt.
  const timeoutMs = action === 'feishuCliInstall' ? 210_000
    : action === 'feishuAuthComplete' ? 660_000 : 60_000;
  return getClient().request('feishu.request',{action,params:params as Record<string,import('@vitalk/plugin-sdk').JsonValue>},{timeoutMs}) as Promise<T>;
}
export async function openFeishuUrl(url:string):Promise<void>{
  const request = getClient().request as (method:string,params:{url:string})=>Promise<unknown>;
  await request('feishu.openExternal',{url});
}
export function dispose(){client?.dispose();client=undefined;}
