import {expect, it, vi} from 'vitest';
import {createCli, CliExecutionError} from './native-cli';

it('sends literal arguments to the plugin dependency with one stable operation id', async () => {
  const request = vi.fn().mockResolvedValue({exitCode:0,stdout:JSON.stringify({ok:true,data:{guid:'task-1'}}),stderr:''});
  const cli=createCli(request);
  expect(await cli(['task','+create','--summary','带电脑来找我; $(echo nope)'],'operation-1')).toEqual({guid:'task-1'});
  expect(request).toHaveBeenCalledWith('native.execute',{dependencyId:'lark-cli',args:['task','+create','--summary','带电脑来找我; $(echo nope)'],operationId:'operation-1'},{timeoutMs:675_000});
});
it('does not retry an uncertain transport outcome or expose raw output', async () => {
  const request=vi.fn().mockRejectedValue(new Error('transport timeout'));
  await expect(createCli(request)(['task','+create'],'operation-2')).rejects.toThrow('transport timeout');
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([
  {exitCode:1,stdout:'secret-token',stderr:'secret-token'},
  {exitCode:0,stdout:'not-json secret-token',stderr:''},
  {exitCode:0,stdout:JSON.stringify({ok:false,error:{message:'secret-token'}}),stderr:''},
])('requires a successful structured CLI receipt', async result => {
  const request=vi.fn().mockResolvedValue(result);
  await expect(createCli(request)(['auth','status','--json'],'operation-3')).rejects.toThrow(/未确认/);
  try { await createCli(request)(['auth','status','--json'],'operation-4'); } catch(error) { expect(String(error)).not.toContain('secret-token'); }
});

it.each([
  [{exitCode:1,stdout:'secret-token',stderr:'secret-token'},'CLI_PROCESS_FAILED',1],
  [{exitCode:0,stdout:'not-json secret-token'},'CLI_INVALID_RECEIPT',0],
  [{exitCode:0,stdout:JSON.stringify({ok:false,error:{code:99991672,message:'secret-token'}})},'CLI_REJECTED',0],
])('retains the failure stage and exit code without leaking CLI output', async (result,code,exitCode) => {
  const error=await createCli(vi.fn().mockResolvedValue(result))(['auth','status'],'diagnostic-operation').catch(error=>error);
  expect(error).toMatchObject({code,exitCode});
  expect(JSON.stringify(error)).not.toContain('secret-token');
  expect(String(error)).not.toContain('secret-token');
});

it.each([0,1])('preserves only numeric upstream rejection codes (exit %s)',async exitCode=>{
 const error=await createCli(vi.fn().mockResolvedValue({exitCode,stdout:JSON.stringify({ok:false,error:{code:99991672,message:'private-token'}})}))(['auth','status'],'diagnostic-code').catch(error=>error);
 if (!(error instanceof CliExecutionError)) throw new Error('Expected CLI error');
 expect(error.upstreamCode).toBe(99991672);
 expect(JSON.stringify(error)).not.toContain('private-token');
});
it('does not copy arbitrary upstream error code strings',async()=>{
 const error=await createCli(vi.fn().mockResolvedValue({exitCode:1,stdout:JSON.stringify({ok:false,error:{code:'private-token'}})}))(['auth','status'],'diagnostic-code').catch(error=>error);
 if (!(error instanceof CliExecutionError)) throw new Error('Expected CLI error');
 expect(error.upstreamCode).toBeUndefined();
 expect(JSON.stringify(error)).not.toContain('private-token');
});
