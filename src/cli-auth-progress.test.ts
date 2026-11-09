import {expect,it} from 'vitest';
import {createRegistrationProgressParser} from './cli-auth-progress';
const url='https://open.feishu.cn/page/cli?token=test';
const bytes=(s:string)=>[...new TextEncoder().encode(s)];
it('decodes split UTF8, URLs and CRLF while emitting just one URL',()=>{
 const parser=createRegistrationProgressParser();const data=bytes(`请授权\r\n  ${url}  \r\n${url}\n`);const results:string[]=[];
 data.forEach((b,i)=>results.push(...parser.push({sequence:i+1,stream:'stderr',bytes:[b]})));
 expect(results).toEqual([url]);expect(parser.finish()).toEqual([]);
});
it('ignores stdout while tracking the global sequence and accepts final unterminated line',()=>{
 const parser=createRegistrationProgressParser();
 expect(parser.push({sequence:1,stream:'stdout',bytes:bytes(`${url}\n`)})).toEqual([]);
 expect(parser.push({sequence:2,stream:'stderr',bytes:bytes(url)})).toEqual([]);
 expect(parser.finish()).toEqual([url]);expect(parser.finish()).toEqual([]);
});
it.each(['http://open.feishu.cn/page/cli?token=x','https://open.feishu.cn.evil.test/page/cli?token=x','https://other.feishu.cn/page/cli?token=x','https://user@open.feishu.cn/page/cli?token=x','https://open.feishu.cn:444/page/cli?token=x','https://open.feishu.cn/other?token=x','https://open.feishu.cn/page/cli','prefix '+url])('ignores nonregistration lines %s',line=>{
 const p=createRegistrationProgressParser();expect(p.push({sequence:1,stream:'stderr',bytes:bytes(line+'\n')})).toEqual([]);
});
it('rejects missing/replayed chunks instead of assembling a corrupted URL',()=>{
 const p=createRegistrationProgressParser();p.push({sequence:1,stream:'stderr',bytes:bytes(url.slice(0,20))});
 expect(()=>p.push({sequence:3,stream:'stderr',bytes:bytes(url.slice(20)+'\n')})).toThrow('序列');expect(p.finish()).toEqual([]);
});
it('bounds total bytes, closes on overflow and never includes output in errors',()=>{
 const p=createRegistrationProgressParser(8);expect(()=>p.push({sequence:1,stream:'stderr',bytes:bytes('secret-token')})).toThrow('过长');expect(p.finish()).toEqual([]);
});
it('rejects malformed UTF8 and discards buffered data on dispose',()=>{
 const p=createRegistrationProgressParser();expect(()=>p.push({sequence:1,stream:'stderr',bytes:[255]})).toThrow('编码');
 const q=createRegistrationProgressParser();q.push({sequence:1,stream:'stderr',bytes:bytes(url)});q.dispose();expect(q.finish()).toEqual([]);
});
