/** Accept the official app link or tenant calendar event link in Feishu receipts. */
export function calendarEventUrl(value:unknown):string|undefined {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    const appLink = url.hostname === 'applink.feishu.cn' && url.pathname.startsWith('/client/calendar/');
    const tenantLink = (url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn')) &&
      url.pathname.startsWith('/calendar/event/');
    if (appLink || tenantLink) return url.href;
  } catch {
    // An unusable link does not invalidate a confirmed event ID.
  }
}
