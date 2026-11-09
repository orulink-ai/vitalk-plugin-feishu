import type {createPluginClient} from '@vitalk/plugin-sdk';
import type {Cli} from './task-service';
import type {FeishuMessageAttachment} from './original-workspace/FeishuMessagePanel';
type Request=ReturnType<typeof createPluginClient>['request'];
export function validateMessageAttachments(value:unknown):FeishuMessageAttachment[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>4)throw Error('最多支持4张 PNG 图片');
 const ids=new Set<string>();
 return value.map(v=>{if(!v||typeof v.id!=='string'||!v.id||ids.has(v.id)||typeof v.dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(v.dataUrl)||v.dataUrl.length>8_000_000||!Number.isInteger(v.width)||!Number.isInteger(v.height)||v.width<1||v.height<1)throw Error('PNG 图片数据无效');ids.add(v.id);return {id:v.id,dataUrl:v.dataUrl,width:v.width,height:v.height};});
}
/** Stage just before upload so drafts can remain open beyond staging TTL.
 * The host validates actual PNG bytes; only its literal returned path reaches CLI. */
export async function uploadMessageAttachments(request:Request,cli:Cli,id:string,text:string,images:FeishuMessageAttachment[],check:()=>Promise<void>):Promise<string[]>{
 const valid=validateMessageAttachments(images);if(!valid.length)return ['--text',text];
 const rows:unknown[]=[[{tag:'text',text}]];
 for(const [index,image] of valid.entries()){
  await check();const staged=await request('files.stage',{dependencyId:'lark-cli',mimeType:'image/png',base64:image.dataUrl.slice('data:image/png;base64,'.length)});
  try{await check();const result=await cli(['im','images','create','--data',JSON.stringify({image_type:'message'}),'--file',staged.path,'--as','user','--format','json'],`message-image-${id}-${index}`) as {image_key?:unknown};
   if(typeof result?.image_key!=='string'||!/^img_[A-Za-z0-9_-]+$/.test(result.image_key))throw Error('图片上传缺少有效回执');rows.push([{tag:'img',image_key:result.image_key}]);
  }finally{await request('files.release',{dependencyId:'lark-cli',fileId:staged.fileId});}
 }
 await check();return ['--msg-type','post','--content',JSON.stringify({zh_cn:{content:rows}})];
}
