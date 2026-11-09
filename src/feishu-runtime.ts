import {readFreshCliStatus} from './cli-auth-refresh';
import {createCli,type NativeRequest} from './native-cli';
import {parseCliAuthStatus} from './cli-auth';
/** Feishu owns CLI commands and identity interpretation. The host sees only
 * a declared dependency and literal arguments. Read calls get fresh IDs;
 * mutation callers must retain their original operation ID. */
export function createFeishuRuntime(request:NativeRequest){
 const cli=createCli(request);
 const readId=()=>`read-${crypto.randomUUID()}`;
 return {
  cli,
  async readAccount(){
   const raw=await readFreshCliStatus(args=>request('native.execute',{dependencyId:'lark-cli',args,operationId:readId()},{timeoutMs:60_000}));
   return parseCliAuthStatus(raw,[]);
  },
  async readApi(path:string,params:Record<string,unknown>,identity:'bot'|'user'='user'){
   if(!/^\/open-apis\/[A-Za-z0-9_/-]+$/.test(path)||path.includes('..'))throw new Error('飞书接口路径无效');
   return cli(['api','GET',path,'--params',JSON.stringify(params),'--as',identity,'--format','json'],readId());
  },
 };
}

