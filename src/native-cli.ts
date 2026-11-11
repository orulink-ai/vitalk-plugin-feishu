/** CLI output is deliberately excluded from errors: it can contain credentials. */
export class CliExecutionError extends Error {
  constructor(public readonly code:string, message:string, public readonly exitCode?:number, public readonly upstreamCode?:number) {
    super(message);
    this.name='CliExecutionError';
  }
}
export type NativeRequest = (
  method: 'native.execute',
  params: {dependencyId:string; args:string[]; operationId:string},
  options: {timeoutMs:number;signal?:AbortSignal;onProgress?:(progress:{sequence:number;stream:'stdout'|'stderr';bytes:number[]})=>void},
) => Promise<unknown>;

export function createCli(request: NativeRequest) {
  return async function cli<T=unknown>(args:string[], operationId:string):Promise<T> {
    // Retain the caller's operation ID; an uncertain mutation must never be retried here.
    const response=await request('native.execute', {dependencyId:'lark-cli',args,operationId}, {timeoutMs:675_000});
    if (!response || typeof response!=='object') throw new CliExecutionError('CLI_INVALID_RESPONSE','飞书未确认操作结果，请先核对远端状态。');
    const result=response as {exitCode?:unknown;stdout?:unknown};
    const exitCode=typeof result.exitCode==='number'&&Number.isSafeInteger(result.exitCode)?result.exitCode:undefined;
    let receipt:unknown;
    try {
      if(typeof result.stdout!=='string')throw new Error();
      receipt=JSON.parse(result.stdout);
    } catch {
      if (result.exitCode!==0) throw new CliExecutionError('CLI_PROCESS_FAILED','飞书未确认操作结果，请先核对远端状态。',exitCode);
      throw new CliExecutionError('CLI_INVALID_RECEIPT','飞书未确认有效回执，请先核对远端状态。',exitCode);
    }
    const rawCode=(receipt as {error?:{code?:unknown}}|null)?.error?.code;
    const upstreamCode=typeof rawCode==='number'&&Number.isSafeInteger(rawCode)?rawCode:undefined;
    if (result.exitCode!==0) throw new CliExecutionError('CLI_PROCESS_FAILED','飞书未确认操作结果，请先核对远端状态。',exitCode,upstreamCode);
    if (!receipt || typeof receipt!=='object' || (receipt as {ok?:unknown}).ok!==true) {
      throw new CliExecutionError('CLI_REJECTED','飞书未确认操作成功，请检查连接与授权后核对远端状态。',exitCode,upstreamCode);
    }
    return (receipt as {data:T}).data;
  };
}
