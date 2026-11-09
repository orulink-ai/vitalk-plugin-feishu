// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({account:'ou_me',values:new Map<string,unknown>(),search:vi.fn(),sync:vi.fn()}));
vi.mock('@vitalk/plugin-sdk',()=>({createWindowTransport:()=>({}),createPluginClient:()=>({dispose(){},request:async(m:string,p:any)=>{if(m==='storage.get')return{value:structuredClone(mocks.values.get(p.key)??null)};if(m==='storage.set'){mocks.values.set(p.key,structuredClone(p.value));return{ok:true};}throw Object.assign(Error('unsupported'),{code:'unsupported_method'});}})}));
vi.mock('./feishu-runtime',()=>({createFeishuRuntime:()=>({readAccount:async()=>({accountId:mocks.account,scopes:[]}),cli:vi.fn()})}));
vi.mock('./contact-service',()=>({searchContacts:mocks.search,syncContacts:mocks.sync}));
import {dispose,feishu} from './client';
afterEach(()=>{dispose();mocks.values.clear();vi.clearAllMocks();mocks.account='ou_me';});
it('retains a searched user for the later draft recipient refresh without dropping groups',async()=>{
 (window as any).__VITALK_PLUGIN_TOKEN__='test';
 mocks.values.set('workspace.ou_me',{accountId:'ou_me',config:{},entries:[],enabled:false,catalog:{recipients:[{id:'oc_team',name:'团队',kind:'group'}],partial:true,lastSync:123}});
 mocks.search.mockResolvedValue({people:[{id:'ou_new',name:'新同事',active:true,external:false}],chats:[]});
 await feishu('feishuSearch',{query:'新同事'});
 const saved:any=mocks.values.get('workspace.ou_me');
 expect(saved.catalog.recipients.map((r:any)=>r.id)).toEqual(['oc_team','ou_new']);
 expect(saved.catalog.lastSync).toBe(123);
 mocks.sync.mockImplementation(async(_cli:any,_id:any,options:any)=>({people:options.cached.map((p:any)=>({...p,active:true,external:false})),chats:[]}));
 const refreshed:any=await feishu('feishuSync');
 expect(refreshed.recipients.some((r:any)=>r.id==='ou_new')).toBe(true);
});
it('allows the freshly authenticated self recipient without promoting unverified colleagues',async()=>{
 (window as any).__VITALK_PLUGIN_TOKEN__='test';
 mocks.search.mockResolvedValue({people:[{id:'ou_me',name:'本人',aliases:[],active:false,external:false},{id:'ou_other',name:'同事',aliases:[],active:false,external:false}],chats:[]});
 const result:any=await feishu('feishuSearch',{query:'本人'});
 expect(result.recipients.find((r:any)=>r.id==='ou_me')).toMatchObject({active:true,external:false});
 expect(result.recipients.find((r:any)=>r.id==='ou_other')).toMatchObject({active:false});
});
it('keeps authenticated self eligible when a sync cannot re-read directory flags',async()=>{
 (window as any).__VITALK_PLUGIN_TOKEN__='test';
 mocks.sync.mockResolvedValue({people:[{id:'ou_me',name:'本人',aliases:[],active:false,external:true},{id:'ou_other',name:'未知联系人',aliases:[],active:false,external:true}],chats:[]});
 const result:any=await feishu('feishuSync');
 expect(result.recipients.find((r:any)=>r.id==='ou_me')).toMatchObject({active:true,external:false});
 expect(result.recipients.find((r:any)=>r.id==='ou_other')).toMatchObject({active:false,external:true});
});
