import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

export function SettingsSection({children,className='',description,icon,title}:{children:ReactNode;className?:string;description:string;icon:ReactNode;title:string}){
  return <section className={`vitalk-settings-section `+className}><header className="vitalk-settings-section-header"><span className="vitalk-settings-section-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div></header>{children}</section>;
}
export function TranscriptionSettingsCard({children}:{children:ReactNode}){return <Card className="vitalk-transcription-card gap-0">{children}</Card>}
export function TranscriptionSettingsRow({control,description,status,label}:{control:ReactNode;description?:string;status?:ReactNode;label:string}){
  return <div className="vitalk-transcription-row"><div className="vitalk-transcription-row-copy"><h3>{label}</h3>{description&&<p>{description}</p>}{status}</div><div className="vitalk-transcription-row-control">{control}</div></div>;
}
