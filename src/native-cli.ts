/** Feishu command construction and response interpretation belong to this plugin.
 * The host accepts only its declared dependency, literal argv and operation ID.
 * A caller must retain its operation ID after an uncertain outcome, never retry
 * a mutation with a fresh ID. No CLI output is logged or persisted here.
 */
export type NativeRequest = (
  method: 'native.execute',
  params: {dependencyId:string; args:string[]; operationId:string},
  options: {timeoutMs:number;signal?:AbortSignal;onProgress?:(progress:{sequence:number;stream:'stdout'|'stderr';bytes:number[]})=>void},
) => Promise<unknown>;

export function createCli(request: NativeRequest) {
  return async function cli<T=unknown>(args:string[], operationId:string):Promise<T> {
    const response=await request('native.execute', {dependencyId:'lark-cli',args,operationId}, {timeoutMs:675_000});
    if (!response || typeof response!=='object') throw new Error('飞书未确认操作结果，请先核对远端状态。');
    const result=response as {exitCode?:unknown;stdout?:unknown};
    if (result.exitCode!==0 || typeof result.stdout!=='string') throw new Error('飞书未确认操作结果，请先核对远端状态。');
    let receipt:unknown;
    try { receipt=JSON.parse(result.stdout); } catch { throw new Error('飞书未确认有效回执，请先核对远端状态。'); }
    if (!receipt || typeof receipt!=='object' || (receipt as {ok?:unknown}).ok!==true) {
      throw new Error('飞书未确认操作成功，请检查连接与授权后核对远端状态。');
    }
    return (receipt as {data:T}).data;
  };
}
