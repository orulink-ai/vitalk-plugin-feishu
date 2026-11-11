import {eligibleMessageRecipient,type MessageRecipient} from './message-intent';
type CandidateState={catalog:{recipients:{id:string;name:string;kind:string;active?:boolean;external?:boolean}[]};entries:{query:string;recipientId:string}[]};
/** Cached contacts are suggestions only. Send/edit still require fresh evidence. */
export async function readDraftCandidates(read:()=>Promise<CandidateState>,refresh:(signal?:AbortSignal)=>Promise<MessageRecipient[]>,signal?:AbortSignal):Promise<MessageRecipient[]>{
 signal?.throwIfAborted();const state=await read();signal?.throwIfAborted();
 const candidates=state.catalog.recipients.filter(r=>(r.kind==='person'||r.kind==='group')&&r.active===true&&r.external===false).map(r=>({...r,kind:r.kind as 'person'|'group',active:true,external:false,aliases:state.entries.filter(e=>e.recipientId===r.id).map(e=>e.query)})).filter(eligibleMessageRecipient);
 return candidates.length?candidates:refresh(signal);
}
