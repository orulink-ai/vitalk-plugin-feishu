import {expect, it, vi} from 'vitest';
import {createCli} from './native-cli';

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
