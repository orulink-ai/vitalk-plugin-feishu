type Progress={sequence:number;stream:'stdout'|'stderr';bytes:number[]};
function registrationUrl(line:string):string|undefined{
 const text=line.trim();
 if(!text||/[\s\u0000-\u001f\u007f]/.test(text))return;
 try{
  const url=new URL(text);
  if(url.protocol==='https:'&&url.hostname==='open.feishu.cn'&&!url.username&&!url.password&&
    (!url.port||url.port==='443')&&url.pathname==='/page/cli'&&url.search.length>1&&!url.hash)return text;
 }catch{/* CLI diagnostics are not authorization URLs. */}
}
/** One parser per `config init --new` invocation. Only stderr lines containing
 * the official registration URL are exposed. No raw output is logged/persisted;
 * after the first URL, even its token is discarded from parser memory. Call
 * finish on process completion, or dispose on cancellation/timeout. */
export function createRegistrationProgressParser(maxBytes=1_000_000){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>1_000_000)throw Error('授权输出长度限制无效');
 let decoder:TextDecoder|undefined=new TextDecoder('utf-8',{fatal:true});
 let pending='',sequence=0,total=0,emitted=false,closed=false;
 function dispose(){closed=true;pending='';decoder=undefined;}
 function fail(message:string):never{dispose();throw Error(message);}
 function parse(text:string,final=false):string[]{
  pending+=text;const lines=pending.split('\n');pending=final?'':lines.pop()!;
  for(const line of lines){
   const url=registrationUrl(line);
   if(url){emitted=true;pending='';decoder=undefined;return [url];}
  }
  return [];
 }
 return {
  push(progress:Progress):string[]{
   if(closed)return [];
   if(!Number.isSafeInteger(progress.sequence)||progress.sequence!==sequence+1)fail('授权输出序列不连续，请重新连接');
   sequence=progress.sequence;
   if(!Array.isArray(progress.bytes)||progress.bytes.some(byte=>!Number.isInteger(byte)||byte<0||byte>255))fail('授权输出字节无效');
   total+=progress.bytes.length;if(total>maxBytes)fail('授权输出过长，请重新连接');
   if(progress.stream!=='stdout'&&progress.stream!=='stderr')fail('授权输出来源无效');
   if(progress.stream==='stdout'||emitted)return [];
   let text:string;
   try{text=decoder!.decode(new Uint8Array(progress.bytes),{stream:true});}catch{fail('授权输出编码无效');}
   return parse(text);
  },
  finish():string[]{
   if(closed||emitted){dispose();return [];}
   try{return parse(decoder!.decode(),true);}catch{fail('授权输出编码无效');}finally{dispose();}
  },
  dispose,
 };
}
