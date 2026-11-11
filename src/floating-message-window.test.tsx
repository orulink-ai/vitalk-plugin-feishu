// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {FloatingMessageWindow} from './floating-message-window';
afterEach(cleanup);
const input={draftId:'d1',recipientId:'ou1',content:'明天带电脑',recipients:[{id:'ou1',name:'小冰',kind:'person' as const}],history:[{id:'h1',prompt:'测试任务',text:'已创建',status:'completed' as const,command:{destination:'feishuTask' as const,task:{guid:'t1',url:'https://applink.feishu.cn/client/todo/detail?guid=t1',assignee:'我',summary:'测试任务'}}}]};
it('keeps the original recipient and editable composer inside the floating window',()=>{
 const decide=vi.fn();render(<FloatingMessageWindow input={input} decide={decide}/>);
 expect(screen.getByText('小冰')).toBeTruthy();
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'后天带电脑'}});
 expect(decide).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'确认发送'}));
 expect(decide).toHaveBeenCalledWith(expect.objectContaining({confirmed:true,draftId:'d1',recipientId:'ou1',content:'后天带电脑'}));
});
it('opens history and returns to the unchanged draft without confirming',()=>{
 const decide=vi.fn();render(<FloatingMessageWindow input={input} decide={decide}/>);
 fireEvent.click(screen.getByRole('button',{name:'历史记录'}));
 expect(screen.getByText('测试任务')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'返回消息'}));
 expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('明天带电脑');
 expect(decide).not.toHaveBeenCalled();
});
it('supports opening history on its own without a message or send action',()=>{
 render(<FloatingMessageWindow input={{...input,historyOnly:true} as any} decide={vi.fn()}/>);
 expect(screen.getByText('测试任务')).toBeTruthy();
 expect(screen.queryByRole('textbox')).toBeNull();
 expect(screen.queryByRole('button',{name:'返回消息'})).toBeNull();
});
