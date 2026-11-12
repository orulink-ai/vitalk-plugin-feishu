import ts from 'typescript';
import {writeFileSync,readFileSync} from 'node:fs';
const bundle=ts.transpileModule(readFileSync('src/message-intent.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {prepareMessage}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputText).toString('base64'));
const root='C:/Users/18063/AppData/Roaming/ai.orulink.vitalk/versions/0.6.21/';
const people=[{id:'ou_42fc5106fd5ca948b6a792f461193a65',name:'阳晓冰',aliases:['小冰'],kind:'person',active:true,external:false},...Array.from({length:15},(_,i)=>({id:'ou_fixture_'+i,name:'测试联系人'+i,aliases:[],kind:'person',active:true,external:false}))];
const source='给阳晓冰发条消息，提醒他等会吃饭。';
if(process.argv.includes('--validate')){
 const result=JSON.parse(readFileSync(root+'model-api-probe-response.json','utf8').trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1'));
 const plan=await prepareMessage(source,people,async()=>result,'简洁自然');
 if(plan.recipient?.id!==people[0].id||!plan.content.includes('吃饭'))throw Error('draft recipient or facts invalid');
 console.log(JSON.stringify({draftValid:true,recipientMatched:true,bodyFactPreserved:true,bodyChars:plan.content.length}));
}else{
 await prepareMessage(source,people,async(input,instructions)=>{const request={messages:[{role:'system',content:instructions},{role:'user',content:JSON.stringify(input)}],maxOutputTokens:4096};writeFileSync(root+'model-api-probe-request.json',JSON.stringify(request)); console.log(JSON.stringify({fixtureGenerated:true,inputChars:request.messages.reduce((n,m)=>n+m.content.length,0),recipientCount:people.length}));return {action:'clarify',content:'提醒等会吃饭。'};},'简洁自然');
}
