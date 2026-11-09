import {expect,it} from 'vitest';
import {authSnapshot,AUTH_SCOPES} from './auth-snapshot';
const raw=(user:unknown)=>({exitCode:0,stdout:JSON.stringify({identities:{user}})});
it('shows disconnected without guessing grants',()=>expect(authSnapshot(raw({})).connected).toBe(false));
it('preserves partial grants for supplemental authorization',()=>{const s=authSnapshot(raw({openId:'ou_me',status:'ready',tokenStatus:'valid',scope:'im:message'}));expect(s.allPermissionsGranted).toBe(false);expect(s.calendarConnected).toBe(false);});
it('shows all grants only with fresh explicit scopes',()=>expect(authSnapshot(raw({openId:'ou_me',status:'ready',tokenStatus:'valid',scope:AUTH_SCOPES.join(' ')})).allPermissionsGranted).toBe(true));
it('does not disguise malformed command failure as disconnected',()=>expect(()=>authSnapshot({exitCode:1,stdout:'bad'})).toThrow());
it('requests delete permission and reports it missing from older grants',()=>{expect(AUTH_SCOPES).toContain('calendar:calendar.event:delete');const result=authSnapshot(raw({openId:'ou_me',status:'ready',tokenStatus:'valid',scope:AUTH_SCOPES.filter(s=>s!=='calendar:calendar.event:delete').join(' ')}));expect(result.calendarMissingScopes).toContain('calendar:calendar.event:delete');expect(result.allPermissionsGranted).toBe(false);});
it('requests image resource permission and detects older grants',()=>{expect(AUTH_SCOPES).toContain('im:resource');const result=authSnapshot(raw({openId:'ou_me',status:'ready',tokenStatus:'valid',scope:AUTH_SCOPES.filter(s=>s!=='im:resource').join(' ')}));expect(result.missingScopes).toContain('im:resource');expect(result.allPermissionsGranted).toBe(false);});
