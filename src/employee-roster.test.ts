import { expect, it, vi } from 'vitest';
import { readEmployeeRoster, type RosterRequest } from './employee-roster';

const active = {is_resigned:false,is_exited:false,is_unjoin:false,is_frozen:false,is_activated:true};
const member = (id:string, status:Record<string, boolean> = active) => ({open_id:id,name:id,status});
const page = (items:unknown[], next?:string) => ({ok:true,data:{items,has_more:!!next,page_token:next}});
const owner = async () => 'ou_owner';
const fixture: RosterRequest = async ({endpoint, params, identity}) => {
  expect(identity).toBe('bot');
  if (endpoint.endsWith('/scopes')) return params.page_token
    ? {code:0,data:{department_ids:['d1'],has_more:false}}
    : {code:0,data:{has_more:true,page_token:'scope-next'}};
  if (endpoint.endsWith('/users')) {
    expect(params).toMatchObject({department_id:'0',page_size:1,user_id_type:'open_id'});
    return {ok:true,data:{code:0,data:{has_more:false}}};
  }
  if (endpoint.endsWith('/departments')) return params.parent_department_id === '0'
    ? page([{department_id:'d1'}]) : page([]);
  if (params.department_id === '0') return page([member('ou_owner'),member('ou_departed',{...active,is_resigned:true})]);
  return params.page_token ? page([member('ou_owner'),member('ou_departed',{...active,is_resigned:true})])
    : page([{...member('ou_worker'),employee_type:3}],'users-next');
};

it('proves full scope and enumerates every department and page, keeping active contract staff', async () => {
  const request=vi.fn(fixture);
  const readAccount=vi.fn(owner);
  const roster=await readEmployeeRoster({request,readAccount});
  expect(roster).toEqual({accountId:'ou_owner',recipients:[{id:'ou_owner',name:'ou_owner'},{id:'ou_worker',name:'ou_worker'}]});
  expect(readAccount).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledTimes(8);
});

it('rejects a scoped tenant even when its scopes list mentions the root department', async () => {
  const request=vi.fn<RosterRequest>().mockResolvedValueOnce({code:0,data:{department_ids:['0'],has_more:false}})
    .mockResolvedValueOnce({code:40004,data:{has_more:false}});
  await expect(readEmployeeRoster({request,readAccount:owner})).rejects.toThrow(/全员通讯录权限核验失败/);
  expect(request).toHaveBeenCalledTimes(2);
});

it.each([{has_more:true},{has_more:true,page_token:'repeat'},{}])('rejects incomplete or repeated pagination %o', async (pagination) => {
  const request: RosterRequest = call => call.endpoint.endsWith('/find_by_department')
    ? Promise.resolve({ok:true,data:{items:[member('ou_owner')],...pagination}}) : fixture(call);
  await expect(readEmployeeRoster({request,readAccount:owner})).rejects.toThrow(/分页/);
});

it.each([[{...active,is_frozen:true},'冻结'],[{...active,is_activated:false},'未激活']])('blocks a partial roster when an employed member is unavailable', async (status,label) => {
  const request: RosterRequest = call => call.endpoint.endsWith('/find_by_department')
    ? Promise.resolve(page([member('ou_owner'),member('ou_blocked',status)])) : fixture(call);
  const error = await readEmployeeRoster({request,readAccount:owner}).catch((error:Error) => error.message);
  expect(error).toContain(label);
  expect(error).not.toMatch(/权限|授权/);
});

it('requires explicit lifecycle evidence and a matching current account', async () => {
  const request: RosterRequest = call => call.endpoint.endsWith('/find_by_department')
    ? Promise.resolve(page([member('ou_owner',{})])) : fixture(call);
  await expect(readEmployeeRoster({request,readAccount:owner})).rejects.toThrow(/状态字段缺失/);
  const switched=vi.fn().mockResolvedValueOnce('ou_owner').mockResolvedValueOnce('ou_other');
  await expect(readEmployeeRoster({request:fixture,readAccount:switched})).rejects.toThrow(/账号.*不一致/);
  await expect(readEmployeeRoster({request:fixture,readAccount:async()=> 'ou_outsider'})).rejects.toThrow(/账号.*不一致/);
});

it('rejects inconsistent active and departed states for the same member across departments', async () => {
  const request: RosterRequest = call => call.endpoint.endsWith('/find_by_department') && call.params.department_id === '0'
    ? Promise.resolve(page([member('ou_owner'),member('ou_departed')])) : fixture(call);
  await expect(readEmployeeRoster({request,readAccount:owner})).rejects.toThrow(/状态不一致.*刷新/);
});
