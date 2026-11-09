import {calendarEventUrl} from './calendar-event-url';
import type {CalendarCreatePlan} from './calendar-service';
const plain=(content:string)=>({tag:'plain_text',content});
function beijing(value:string){
  if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('日程时间无效');
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
}
/** Share a confirmed event using text-only user content and its real receipt URL. */
export function calendarCard(plan:CalendarCreatePlan,eventUrl:string){
  const url=calendarEventUrl(eventUrl);
  if(!url)throw Error('日程详情链接无效');
  if(!plan.summary.trim()||Date.parse(plan.end)<=Date.parse(plan.start))throw Error('日程内容无效');
  const elements:Record<string,unknown>[]=[{tag:'div',text:plain(`${beijing(plan.start)} — ${beijing(plan.end)}（北京时间）`)}];
  if(plan.description.trim())elements.push({tag:'div',text:plain(plan.description)});
  elements.push({tag:'button',text:plain('查看日程'),type:'primary',behaviors:[{type:'open_url',default_url:url}]});
  elements.push({tag:'div',text:{...plain('请在日程详情中查看安排并回复邀请'),text_size:'notation',text_color:'grey'}});
  return {schema:'2.0',config:{update_multi:true,width_mode:'default'},header:{template:'blue',title:plain(plan.summary),subtitle:plain('日程邀请')},body:{direction:'vertical',padding:'16px',elements}};
}
