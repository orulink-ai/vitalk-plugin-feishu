import {createRoot} from 'react-dom/client';
import {FloatingMessageWindow,type FloatingInput} from './floating-message-window';
import './style.css';
import './original-workspace/notice-surface.css';
import './floating-message.css';
declare global {interface Window {__FEISHU_DIALOG__:FloatingInput;chrome:{webview:{postMessage:(value:unknown)=>void}};}}
const post=(value:unknown)=>window.chrome.webview.postMessage(value);
createRoot(document.getElementById('root')!).render(<FloatingMessageWindow input={window.__FEISHU_DIALOG__} decide={post} drag={()=>post({action:'drag'})} resize={layout=>post({action:'resize',layout})}/>);
