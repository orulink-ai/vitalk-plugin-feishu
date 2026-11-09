import {expect,it,vi} from 'vitest';
import {createIntentModel} from './intent-model';
it('uses configured host model with separate instructions and serialized data',async()=>{
  const generate=vi.fn().mockResolvedValue({text:'{"action":"create"}'});
  expect(await createIntentModel(generate)({source:'让小冰带电脑来找我'},'理解自然语言')).toEqual({action:'create'});
  expect(generate.mock.calls[0][0]).toMatchObject({messages:[{role:'system',content:'理解自然语言'},{role:'user',content:JSON.stringify({source:'让小冰带电脑来找我'})}]});
  expect(generate.mock.calls[0][0]).not.toHaveProperty('model');
});
it('accepts JSON code fences, without imposing a user utterance format',async()=>{
  expect(await createIntentModel(vi.fn().mockResolvedValue({text:'```json\n{"supported":true}\n```'}))({},'核对')).toEqual({supported:true});
});
it.each(['not-json','[]','null','true','{"x":1} trailing'])('rejects malformed model output %s without executing anything',async text=>{
  await expect(createIntentModel(vi.fn().mockResolvedValue({text}))({},'核对')).rejects.toThrow('模型');
});
