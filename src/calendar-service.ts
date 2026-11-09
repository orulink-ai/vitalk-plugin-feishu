import {calendarEventUrl} from './calendar-event-url';
import type {Cli} from './task-service';

export type CalendarCreatePlan = Readonly<{
  summary: string;
  description: string;
  start: string;
  end: string;
  /** Resolved attendee IDs from the current account or a verified company roster. */
  participantIds: readonly string[];
  allowConflict?: boolean;
}>;

export type CalendarReceipt = Readonly<{
  calendarId: string;
  eventId: string;
  url: string;
  status: 'completed' | 'partial';
  invitationStatus: 'not_sent' | 'pending' | 'sent' | 'unconfirmed' | 'cancelled';
  participantCount: number;
  invitedCount: number;
  /** IDs returned by successful invitation responses, never inferred from counts. */
  confirmedRecipientIds?: readonly string[];
  reason: string;
  persistenceWarning?: string;
}>;

type Options = {
  beforeSubmit?: (phase: 'create' | 'invite') => void | Promise<void>;
  onCreated?: (receipt: CalendarReceipt) => void | Promise<void>;
};

function record(value: unknown): Record<string,unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string,unknown>;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_@.:-]{0,255}$/.test(value);
}

function timestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const date = value.slice(0,10);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0,10) !== date) return NaN;
  return Date.parse(value);
}

/** The host native execution ledger claims each stage. Retain the operation ID
 * after uncertainty and reconcile through a separate read. Production callers
 * supply beforeSubmit to recheck the current account and cancellation state. */
export async function createCalendar(cli: Cli, plan: CalendarCreatePlan, operationId: string, options: Options = {}): Promise<CalendarReceipt> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new Error('日程操作编号必须是有效 UUID。');
  }
  const {summary,description,start,end,allowConflict} = plan;
  if (typeof summary !== 'string' || !summary.trim() || [...summary].length > 500 || summary.includes('\0')) {
    throw new Error('日程标题须为 1 到 500 字，尚未预约。');
  }
  if (typeof description !== 'string' || new TextEncoder().encode(description).length > 8000 || description.includes('\0')) {
    throw new Error('日程说明不得超过 8000 字节，尚未预约。');
  }
  const startMs = timestamp(start);
  const endMs = timestamp(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || Math.floor(endMs/1000) <= Math.floor(startMs/1000) || endMs-startMs > 86_400_000) {
    throw new Error('日程起止时间无效，尚未预约。');
  }
  const participants = [...new Set(plan.participantIds)].sort();
  if (participants.some(id => !/^ou_[A-Za-z0-9_]{1,125}$/.test(id))) throw new Error('日程参与人无效，尚未预约。');

  const key = operationId.toLowerCase();
  const run = (args:string[], stage:string) => cli([...args,'--as','user','--format','json'],`${key}:${stage}`);
  const primary = record(await run(['calendar','calendars','primary'],'primary'));
  const calendars = Array.isArray(primary?.calendars) ? primary.calendars : [];
  const eligible = calendars.map(row => record(record(row)?.calendar)).filter(calendar =>
    calendar && (calendar.role === 'owner' || calendar.role === 'writer') && calendar.is_deleted !== true && calendar.is_third_party !== true,
  );
  const calendarId = eligible[0]?.calendar_id;
  if (eligible.length !== 1 || !identifier(calendarId)) throw new Error('未取得唯一可写主日历，尚未预约。');

  if (!allowConflict) {
    for (const [index, user_id] of participants.entries()) {
      const data = JSON.stringify({time_min:start,time_max:end,user_id,only_busy:true});
      const busy = record(await run(['calendar','freebusys','list','--user-id-type','open_id','--data',data],`busy:${index}`));
      if (!Array.isArray(busy?.freebusy_list)) {
        throw new Error('飞书忙闲响应格式无效，尚未预约。');
      }
      if (busy.freebusy_list.length) {
        throw new Error('该时段有参与人已有日程，尚未预约。');
      }
    }
  }

  const zone = 'Asia/Shanghai';
  const data = JSON.stringify({
    summary,description,
    start_time:{timestamp:String(Math.floor(startMs/1000)),timezone:zone},
    end_time:{timestamp:String(Math.floor(endMs/1000)),timezone:zone},
    visibility:'private',attendee_ability:'can_see_others',free_busy_status:'busy',need_notification:false,reminders:[{minutes:5}],
  });
  await options.beforeSubmit?.('create');
  const uncertain = '日程创建结果未确认，请在飞书核对。不会重复预约。';
  let event: Record<string,unknown> | undefined;
  try {
    const result = await run(['calendar','events','create','--calendar-id',calendarId,'--idempotency-key',key,'--data',data],'create');
    event = record(record(result)?.event);
  } catch {
    throw new Error(uncertain);
  }
  if (!identifier(event?.event_id)) throw new Error(uncertain);

  const eventId = event.event_id;
  const url = calendarEventUrl(event.app_link) ?? '';
  const confirmed = new Set<string>();
  const participantCount = participants.length;
  const makeReceipt = (invitationStatus:CalendarReceipt['invitationStatus'], reason:string, persistenceWarning?:string):CalendarReceipt => Object.freeze({
    calendarId,eventId,url,
    status: persistenceWarning || (invitationStatus !== 'sent' && participantCount > 0) ? 'partial' : 'completed',
    invitationStatus,participantCount,invitedCount:confirmed.size,confirmedRecipientIds:Object.freeze([...confirmed].sort()),reason,
    ...(persistenceWarning ? {persistenceWarning} : {}),
  });

  const created = participantCount
    ? makeReceipt('pending','日程已创建，参会邀请尚未提交。')
    : makeReceipt('not_sent','日程已创建，未添加参与人。');
  try {
    await options.onCreated?.(created);
  } catch {
    const warning = '本地回执保存失败，请在飞书核对。不会自动重建日程或重发邀请。';
    return makeReceipt('not_sent',participantCount ? '日程已创建，邀请未发送。' : created.reason,warning);
  }
  if (!participantCount) return created;

  const incomplete = () => makeReceipt('unconfirmed',`日程已创建，已确认提交 ${confirmed.size}/${participantCount} 人的邀请。其余结果请在飞书核对，不会自动重邀。`);
  for (let offset=0; offset<participantCount; offset+=100) {
    const batch = participants.slice(offset,offset+100);
    const body = JSON.stringify({attendees:batch.map(user_id=>({type:'user',user_id})),need_notification:true});
    try {
      await options.beforeSubmit?.('invite');
    } catch {
      return makeReceipt('cancelled',`日程已创建，已确认提交 ${confirmed.size}/${participantCount} 人的邀请。后续邀请在提交前停止。`);
    }
    try {
      const result = record(await run(['calendar','event.attendees','create','--calendar-id',calendarId,'--event-id',eventId,'--user-id-type','open_id','--data',body],`invite:${offset/100}`));
      if (!Array.isArray(result?.attendees)) return incomplete();
      const batchIds = new Set(batch);
      for (const attendee of result.attendees) {
        const id = record(attendee)?.user_id;
        if (typeof id === 'string' && batchIds.has(id)) confirmed.add(id);
      }
      if (batch.some(id => !confirmed.has(id))) return incomplete();
    } catch {
      return incomplete();
    }
  }
  return makeReceipt('sent','日程已创建，已提交正式日程邀请和参与人通知。接受状态以飞书日程为准。');
}
