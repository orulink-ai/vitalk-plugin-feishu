type Params = Record<string, string | number | boolean>;
export type RosterRequest = (call: {
  endpoint: string;
  identity: 'bot';
  params: Params;
}) => Promise<unknown>;

type Recipient = Readonly<{id:string; name:string}>;
export type EmployeeRoster = Readonly<{accountId:string; recipients:readonly Recipient[]}>;

const directory = '/open-apis/contact/v3';
const idTypes = {department_id_type:'department_id',user_id_type:'open_id'};
const lifecycle = ['is_resigned','is_exited','is_unjoin','is_frozen','is_activated'] as const;

function incomplete(reason: string) {
  return new Error(`无法完整核验全公司在职员工（${reason}）。请管理员检查应用通讯录数据范围是否为全部成员，并核对通讯录、部门及用户受雇信息权限。`);
}

function object(value: unknown): Record<string,unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string,unknown>;
}

function responseData(value: unknown) {
  const envelope = object(value);
  if (envelope?.ok === true) {
    const payload = object(envelope.data);
    if (payload && !('code' in payload)) return payload;
    if (payload?.code === 0 && object(payload.data)) return object(payload.data)!;
  } else if (envelope && !('ok' in envelope) && envelope.code === 0 && object(envelope.data)) {
    return object(envelope.data)!;
  }
  throw incomplete('通讯录响应未确认成功');
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^ou_[A-Za-z0-9_]+$/.test(value);
}

/** Read a fresh tenant roster. The caller supplies application-identity directory
 * requests and live user-account reads from the same CLI configuration. */
export async function readEmployeeRoster({request,readAccount}: {
  request: RosterRequest;
  readAccount: () => Promise<string>;
}): Promise<EmployeeRoster> {
  const accountId = await readAccount();
  if (!validId(accountId)) throw new Error('当前飞书账号无效，无法核验全公司名册。');

  async function fetch(endpoint: string, params: Params, failure: string) {
    try {
      return responseData(await request({endpoint:`${directory}/${endpoint}`,identity:'bot',params}));
    } catch {
      throw incomplete(failure);
    }
  }

  async function* pages(endpoint: string, params: Params, failure: string) {
    const seen = new Set<string>();
    let token: string | undefined;
    for (;;) {
      const data = await fetch(endpoint, token ? {...params,page_token:token} : params, failure);
      if (typeof data.has_more !== 'boolean') throw incomplete('分页状态缺失');
      if (data.has_more) {
        if (typeof data.page_token !== 'string' || !data.page_token.trim()) throw incomplete('分页标记缺失');
        if (seen.has(data.page_token) || seen.size >= 10_000) throw incomplete('分页标记重复或分页过多');
        token = data.page_token;
        seen.add(token);
      }
      yield data;
      if (!data.has_more) return;
    }
  }

  for await (const page of pages('scopes', {...idTypes,page_size:100}, '无法读取应用通讯录权限范围')) {
    for (const key of ['department_ids','user_ids','group_ids']) {
      const ids = page[key];
      if (key in page && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))) {
        throw incomplete('通讯录权限范围格式无效');
      }
    }
  }

  // The application-identity legacy root user list enforces all-member access.
  // A scope listing can describe a restricted directory and cannot prove this.
  const proof = await fetch('users', {...idTypes,department_id:'0',page_size:1}, '根部门全员通讯录权限核验失败');
  if (typeof proof.has_more !== 'boolean') throw incomplete('根部门权限响应无效');

  const departments = ['0'];
  const seenDepartments = new Set(departments);
  const recipients = new Map<string, Recipient>();
  const excluded = new Set<string>();
  for (const departmentId of departments) {
    for (const [endpoint, params] of [
      ['users/find_by_department',{...idTypes,department_id:departmentId,page_size:50}],
      ['departments',{...idTypes,parent_department_id:departmentId,fetch_child:false,page_size:50}],
    ] as const) {
      for await (const page of pages(endpoint, params, '部门或成员分页读取失败')) {
        // The CLI can omit an empty list on the terminal page.
        const items = page.items === undefined && page.has_more === false ? [] : page.items;
        if (!Array.isArray(items)) throw incomplete('部门或成员列表缺失');
        for (const item of items) {
          const row = object(item);
          if (endpoint === 'departments') {
            const id = row?.department_id;
            if (typeof id !== 'string' || !id.trim() || seenDepartments.has(id)) {
              throw incomplete('部门结构重复或部门ID无效');
            }
            if (departments.length >= 20_000) throw incomplete('部门数量超过安全读取上限');
            seenDepartments.add(id);
            departments.push(id);
            continue;
          }

          const id = row?.open_id;
          if (!validId(id)) throw incomplete('成员open_id无效');
          const status = object(row?.status);
          if (!status || lifecycle.some(key => typeof status[key] !== 'boolean')) {
            throw incomplete('员工状态字段缺失');
          }
          const departed = status.is_resigned || status.is_exited || status.is_unjoin;
          if ((departed && recipients.has(id)) || (!departed && excluded.has(id))) {
            throw new Error('同一成员在不同部门的员工状态不一致，请刷新名册后再试。');
          }
          if (departed) {
            excluded.add(id);
            continue;
          }
          if (status.is_frozen || !status.is_activated) {
            const state = status.is_frozen ? '冻结' : '未激活';
            throw new Error(`无法完整邀请全部在职员工。名册中存在${state}的在职员工，请先核实并处理成员账号状态。`);
          }
          const name = row?.name;
          if (typeof name !== 'string' || !name.trim()) throw incomplete('成员姓名缺失');
          recipients.set(id, Object.freeze({id,name}));
          if (recipients.size > 100_000) throw incomplete('名册超过安全读取上限');
        }
      }
    }
  }

  if (await readAccount() !== accountId || !recipients.has(accountId)) {
    throw new Error('当前飞书账号与应用通讯录不一致，无法核验全公司名册。');
  }
  const sorted = [...recipients.keys()].sort().map(id => recipients.get(id)!);
  return Object.freeze({accountId,recipients:Object.freeze(sorted)});
}
