/** Feishu IM accepts at most 50 characters in a provider idempotency key.
 * The host operation ID is separate and remains unchanged.
 */
export async function cardIdempotencyKey(kind:'task'|'calendar', operationId:string, recipientId:string) {
  const input = new TextEncoder().encode(JSON.stringify([kind,operationId,recipientId]));
  const hash = await crypto.subtle.digest('SHA-256',input);
  const token = Array.from(new Uint8Array(hash).slice(0,20),byte=>byte.toString(16).padStart(2,'0')).join('');
  return 'vt-card-'+token;
}
