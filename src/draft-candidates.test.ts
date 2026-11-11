import {expect,it,vi} from 'vitest';
import {readDraftCandidates} from './draft-candidates';
it('uses qualified cached candidates and current aliases without a directory sync',async()=>{
 const refresh=vi.fn();const read=async()=>({catalog:{recipients:[{id:'ou_bing',name:'小冰',kind:'person',active:true,external:false}]},entries:[{query:'冰哥',recipientId:'ou_bing'}]});
 expect(await readDraftCandidates(read,refresh)).toEqual([{id:'ou_bing',name:'小冰',kind:'person',active:true,external:false,aliases:['冰哥']}]);expect(refresh).not.toHaveBeenCalled();
});
it('refreshes unqualified legacy caches and stops on cancellation',async()=>{
 const refresh=vi.fn().mockResolvedValue([]);const read=async()=>({catalog:{recipients:[{id:'ou_old',name:'旧联系人',kind:'person'}]},entries:[]});
 await readDraftCandidates(read,refresh);expect(refresh).toHaveBeenCalledTimes(1);
 const c=new AbortController();c.abort();await expect(readDraftCandidates(read,refresh,c.signal)).rejects.toThrow();expect(refresh).toHaveBeenCalledTimes(1);
});
