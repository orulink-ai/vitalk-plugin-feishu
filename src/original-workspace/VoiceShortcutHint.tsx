import {Keyboard} from "lucide-react";
import type {ExperimentsConfig} from "../experiments/client";
import "./voice-shortcut-hint.css";
export function VoiceShortcutHint({purpose,config,onOpenSettings}:{purpose:"message"|"task"|"calendar";config:ExperimentsConfig;onOpenSettings?:()=>void}) {
  const label={message:"消息",task:"任务",calendar:"日程"}[purpose];
  const hotkey=config.pluginShortcuts?.find(item=>item.pluginId==="vitalk-plugin-feishu"&&(item.purpose||"message")===purpose)?.hotkey.trim();
  const disabled=!config.feishuTools;
  const content=<><Keyboard size={13}/>{hotkey?<><kbd>{hotkey}</kbd>{disabled&&<span>未启用</span>}</>:<span>设置快捷键</span>}</>;
  const name=hotkey?`查看${label}语音快捷键：${hotkey}${disabled?"，未启用":""}`:`设置${label}语音快捷键`;
  return onOpenSettings?<button type="button" className="feishu-voice-key-hint" aria-label={name} title="按一次开始，再按一次结束；点击查看或修改快捷键" onClick={onOpenSettings}>{content}</button>:<span className="feishu-voice-key-hint" aria-label={name}>{content}</span>;
}
