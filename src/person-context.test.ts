import {expect,it} from 'vitest';
import {allContactIds,personContext} from './person-context';
const people=[{id:'ou_me',name:'阳晓冰',aliases:[],active:true,external:false},{id:'ou_other',name:'同事',aliases:[],active:true,external:false}];
it('keeps live names and adds the same self words and confirmed object aliases',()=>{
 const result=personContext(people,'ou_me',[{query:'小冰',recipientId:'ou_me'},{query:'老板',recipientId:'ou_other'},{query:'自己',recipientId:'ou_other'},{query:'无效对象',recipientId:'ou_missing'}]);
 expect(result[0]).toMatchObject({name:'阳晓冰',aliases:expect.arrayContaining(['我','自己','本人','小冰'])});
 expect(result[1].aliases).toEqual(['老板']);expect(JSON.stringify(result)).not.toContain('无效对象');
 expect(people[0].aliases).toEqual([]);
});
it('all contacts means verified individuals, never groups, bots, outsiders or duplicate IDs',()=>{
 expect(allContactIds([...people,...people,{...people[1],id:'oc_group',kind:'group'},{...people[1],id:'ou_bot',kind:'bot'},{...people[1],id:'ou_external',external:true},{...people[1],id:'ou_unknown',active:false}])).toEqual(['ou_me','ou_other']);
});
