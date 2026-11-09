import type {TaskPlan} from './task-intent';
const plain=(content:string)=>({tag:'plain_text',content});
function deadline(value:string){
  const dateOnly=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(dateOnly)return `${Number(dateOnly[1])}年${Number(dateOnly[2])}月${Number(dateOnly[3])}日`;
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('任务截止日期无效');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const field=(name:string)=>parts.find(p=>p.type===name)!.value;
  return `${field('year')}年${Number(field('month'))}月${Number(field('day'))}日 ${field('hour')}:${field('minute')}（北京时间）`;
}
/** Plugin-owned card template. This is an interactive share card, not a native
 * todo message. User content must never become mention or Markdown instructions.
 */
export function taskCard(task:Omit<TaskPlan,'action'>,guid:string){
  if(!/^[A-Za-z0-9-]{1,80}$/.test(guid)||!/^ou_[A-Za-z0-9_]+$/.test(task.assigneeId))throw new Error('任务通知对象或详情链接无效');
  const elements:Record<string,unknown>[]=[
    {tag:'div',text:{...plain('负责人'),text_size:'notation',text_color:'grey'}},
    {tag:'person_list',persons:[{id:task.assigneeId}],show_name:true,show_avatar:true,size:'small'},
  ];
  if(task.due)elements.push({tag:'div',text:plain(`截止：${deadline(task.due)}`)});
  if(task.description.trim())elements.push({tag:'div',text:plain(task.description)});
  elements.push({tag:'button',text:plain('查看任务'),type:'primary',behaviors:[{type:'open_url',default_url:`https://applink.feishu.cn/client/todo/detail?guid=${guid}`}]});
  elements.push({tag:'div',text:{...plain('请在任务详情中查看进度或完成任务'),text_size:'notation',text_color:'grey'}});
  return {schema:'2.0',config:{update_multi:true,width_mode:'default'},header:{template:'blue',title:plain(task.summary),subtitle:plain('任务分配')},body:{direction:'vertical',padding:'16px',elements}};
}
