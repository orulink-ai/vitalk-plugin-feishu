import type {Person} from './task-intent';
export type PersonAlias={query:string;recipientId:string};
export const ALL_CONTACTS_ID='all-contacts';
const selfWords=['我','自己','本人','我自己','我本人'];
export class PreparationError extends Error{readonly code='NOT_SUBMITTED';}
export function personContext(people:readonly Person[],accountId:string,aliases:readonly PersonAlias[],includeMissingSelf=true):Person[]{
 const result=people.map(person=>({...person,aliases:[...new Set([...(person.aliases??[]),...aliases.filter(a=>a.recipientId===person.id).map(a=>a.query.trim()).filter(a=>a.length>0&&a.length<=50),...(person.id===accountId?selfWords:[])].filter(alias=>person.id===accountId||!selfWords.includes(alias)))]}));
 if(/^ou_[A-Za-z0-9_]+$/.test(accountId)){
  const self=result.find(person=>person.id===accountId);
  if(self){self.active=true;self.external=false;}
  else if(includeMissingSelf)result.push({id:accountId,name:'我（当前账号）',aliases:['我','自己','本人','我自己','我本人'],active:true,external:false,isContact:false});
 }
 return result;
}
export function allContactIds(people:readonly {id:string;kind?:string;active:boolean;external:boolean;isContact?:boolean}[]):string[]{
 return [...new Set(people.filter(p=>p.isContact!==false&&(!p.kind||p.kind==='person')&&p.active===true&&p.external===false&&/^ou_[A-Za-z0-9_]+$/.test(p.id)).map(p=>p.id))];
}
