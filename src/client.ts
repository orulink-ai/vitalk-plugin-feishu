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
  return getClient().request('feishu.request',{action,params:params as Record<string,import('@vitalk/plugin-sdk').JsonValue>}) as Promise<T>;
}
export function dispose(){client?.dispose();client=undefined;}
