import {createRoot} from 'react-dom/client';
import {App} from './App';
import {dispose} from './client';
import './style.css';
const root=createRoot(document.getElementById('root')!);
root.render(<App/>);
window.addEventListener('pagehide',()=>{root.unmount();dispose();},{once:true});
