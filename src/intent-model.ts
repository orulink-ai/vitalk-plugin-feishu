import type {GenerateParams} from '@vitalk/plugin-sdk';
/** Uses the user's configured model. Structured output is an internal protocol,
 * never a requirement on what the user must say. Provider diagnostics stay out
 * of the user-facing error and operation history.
 */
export function createIntentModel(generate:(params:GenerateParams)=>Promise<{text:string}>){
  return async (input:unknown,instructions:string):Promise<Record<string,unknown>>=>{
    const response=await generate({messages:[{role:'system',content:instructions},{role:'user',content:JSON.stringify(input)}],maxOutputTokens:4096});
    if(typeof response.text!=='string'||response.text.length>64000)throw new Error('模型未返回有效的意图结果，未执行操作。');
    const text=response.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1');
    let value:unknown;
    try{value=JSON.parse(text);}catch{throw new Error('模型未返回有效的意图结果，未执行操作。');}
    if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('模型未返回有效的意图结果，未执行操作。');
    return value as Record<string,unknown>;
  };
}
