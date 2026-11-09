import {useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {deleteWorkspaceEvent,deleteWorkspaceTask,editWorkspaceTask,editWorkspaceEvent,readWorkspaceEventForEdit} from "../workspace-record-service";
import {shanghaiDate,validDate,type EventTime} from "./workspace-calendar";
type Event = Awaited<ReturnType<typeof readWorkspaceEventForEdit>>;
type Task = Extract<Awaited<ReturnType<typeof editWorkspaceTask>>,{status:"updated"}>["task"];

type Props = {id:string;accountId:string;title:string;disabled?:boolean;onDeleted:(message:string)=>void} & (
  {kind:"task";description:string;onUpdated:(task:Task)=>void} |
  {kind:"event";calendarId:string;onEventUpdated:(event:Event)=>void}
);

function eventInput(time:EventTime) {
  if (time.date) return time.date;
  const ms = Number(time.timestamp) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const day = shanghaiDate(ms);
  const clock = new Date(ms).toLocaleTimeString("sv-SE",{timeZone:"Asia/Shanghai",hourCycle:"h23"});
  return day+"T"+clock;
}
function submittedTime(value:string,original:EventTime):EventTime {
  if (value === eventInput(original)) {
    return original.date ? {date:original.date} : {timestamp:original.timestamp};
  }
  if (original.date && validDate(value)) return {date:value};
  if (!original.date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) && validDate(value.slice(0,10))) {
    const ms = Date.parse(value+"+08:00");
    if (Number.isFinite(ms)) return {timestamp:String(ms/1000)};
  }
  throw new Error("请选择有效的开始和结束时间。");
}

export function WorkspaceRecordActions(props:Props) {
  const {id,accountId,kind,disabled,onDeleted}=props;
  const name=kind==="task"?"任务":"日程";
  const [mode,setMode]=useState<"edit"|"delete">();
  const [title,setTitle]=useState(props.title);
  const [description,setDescription]=useState(props.kind==="task"?props.description:"");
  const [originalEvent,setOriginalEvent]=useState<Event>();
  const [start,setStart]=useState("");
  const [end,setEnd]=useState("");
  const [busy,setBusy]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [receipt,setReceipt]=useState<{message:string;error:boolean}>();
  const lock=useRef(false);
  async function beginEdit() {
    if (lock.current || disabled || blocked) return;
    setReceipt(undefined);
    if (props.kind === "task") {
      setTitle(props.title);
      setDescription(props.description);
      setMode("edit");
      return;
    }
    lock.current=true;
    setBusy(true);
    try {
      const event=await readWorkspaceEventForEdit({id,accountId,calendarId:props.calendarId});
      setTitle(event.title);
      setDescription(event.description);
      setStart(eventInput(event.start));
      setEnd(eventInput(event.end));
      setOriginalEvent(event);
      setMode("edit");
    } catch(error) {
      setReceipt({message:error instanceof Error?error.message:"无法读取飞书日程。",error:true});
    } finally {
      lock.current=false;
      setBusy(false);
    }
  }
  async function submit() {
    if (lock.current || disabled || blocked || !mode) return;
    lock.current=true;
    setBusy(true);
    setReceipt(undefined);
    try {
      if (mode==="edit" && props.kind==="event" && !originalEvent) throw new Error("请重新打开日程编辑。");
      const result=mode==="edit"
        ? props.kind==="task"
          ? await editWorkspaceTask({id,accountId,title,description})
          : await editWorkspaceEvent({id,accountId,calendarId:props.calendarId,title,description,
              start:submittedTime(start,originalEvent!.start),end:submittedTime(end,originalEvent!.end),expected:originalEvent})
        : props.kind==="task"
          ? await deleteWorkspaceTask({id,accountId})
          : await deleteWorkspaceEvent({id,accountId,calendarId:props.calendarId});
      if (result.status!=="deleted") setReceipt({message:result.message,error:result.status==="uncertain"});
      setMode(undefined);
      if (result.status==="uncertain") setBlocked(true);
      if (result.status==="updated" && props.kind==="task") props.onUpdated(result.task);
      if (result.status==="eventUpdated" && props.kind==="event") props.onEventUpdated(result.event);
      if (result.status==="deleted") onDeleted(result.message);
    } catch(error) {
      setReceipt({message:error instanceof Error?error.message:"飞书操作失败。",error:true});
    } finally {
      lock.current=false;
      setBusy(false);
    }
  }
  return <div className="flex flex-col gap-2">
    {receipt&&<p role={receipt.error?"alert":"status"}>{receipt.message}</p>}
    {mode==="edit"&&<>
      <label className="flex flex-col gap-1">{name}标题<Input value={title} maxLength={kind==="task"?3000:1000} disabled={busy} onChange={event=>setTitle(event.target.value)}/></label>
      <label className="flex flex-col gap-1">{name}说明<Textarea value={description} maxLength={kind==="task"?3000:8000} disabled={busy} onChange={event=>setDescription(event.target.value)}/></label>
      {kind==="event"&&originalEvent&&<>
        <label className="flex flex-col gap-1">开始{originalEvent.start.date?"日期":"时间（北京时间）"}
          <Input type={originalEvent.start.date?"date":"datetime-local"} step={originalEvent.start.date?undefined:1} value={start} disabled={busy} onChange={event=>setStart(event.target.value)}/>
        </label>
        <label className="flex flex-col gap-1">结束{originalEvent.end.date?"日期":"时间（北京时间）"}
          <Input type={originalEvent.end.date?"date":"datetime-local"} step={originalEvent.end.date?undefined:1} value={end} disabled={busy} onChange={event=>setEnd(event.target.value)}/>
        </label>
      </>}
    </>}
    {mode==="delete"&&<p>确定删除{name}「{props.title || "未命名"}」？</p>}
    <div className="flex flex-wrap gap-2">
      {mode ? <>
        <Button type="button" variant={mode==="delete"?"destructive":"default"} disabled={busy||disabled||(mode==="edit"&&!title.trim())} onClick={()=>void submit()}>
          {busy?"提交中…":mode==="delete"?"确认删除"+name:"保存修改"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={()=>{setMode(undefined);setReceipt(undefined);}}>取消</Button>
      </>:<>
        <Button type="button" variant="outline" disabled={busy||blocked||disabled} onClick={()=>void beginEdit()}>
          {busy?"读取中…":"编辑"+name}
        </Button>
        <Button type="button" variant="outline" disabled={busy||blocked||disabled} onClick={()=>{setMode("delete");setReceipt(undefined);}}>删除{name}</Button>
      </>}
    </div>
  </div>;
}
