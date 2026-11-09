/** Read-only token refresh; the CLI retains ownership of credential storage. */
import {parseCliAuthStatus,refreshableCliAccount,verifyCliReadReceipt} from './cli-auth';
export async function readFreshCliStatus(run:(args:string[])=>Promise<unknown>):Promise<unknown>{
 const initial=await run(['auth','status','--json']);
 const account=refreshableCliAccount(initial);
 if(!account)return initial;
 verifyCliReadReceipt(await run(['api','GET','/open-apis/authen/v1/user_info','--as','user','--format','json']));
 const fresh=await run(['auth','status','--json']);
 if(parseCliAuthStatus(fresh,[]).accountId!==account)throw Error('飞书刷新后的账号不一致，请重新检查连接。');
 return fresh;
}
