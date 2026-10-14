// TASK-523 — WsClient.request(): a reply carrying the same correlation id resolves it; an error reply, a timeout, a
// socket close and disconnect() reject it; unsolicited messages still reach the handlers. Against a fake socket: the
// global WebSocket is swapped only for the synchronous connect() call, so no other suite can see the fake.
import { WsClient } from 'birko-web-core';

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(public url: string) { FakeSocket.last = this; }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  drop() { this.readyState = 3; this.onclose?.(new CloseEvent('close', { code: 1006 })); }
  lastSent(): Record<string, unknown> { return JSON.parse(this.sent.at(-1) ?? '{}'); }
}

function connectFake(client: WsClient): FakeSocket {
  const real = globalThis.WebSocket;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  try { client.connect(); } finally { globalThis.WebSocket = real; }
  const sock = FakeSocket.last!;
  sock.open();
  return sock;
}

const outcome = async (p: Promise<unknown>) => {
  try { return { ok: true, value: await p }; } catch (e) { return { ok: false, error: (e as Error).message }; }
};

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const clients: WsClient[] = [];
  const make = (opts: Partial<ConstructorParameters<typeof WsClient>[0]> = {}) => {
    const c = new WsClient({ url: 'ws://smoke.test/ws', reconnectMs: 0, heartbeatMs: 0, ...opts });
    clients.push(c);
    return c;
  };

  try {
    // ── 1. The reply with the same id resolves, with its data; the envelope carries the id at the top level ──
    {
      const c = make();
      const s = connectFake(c);
      const p = c.request('get_stats', { range: 24 });
      const sent = s.lastSent();
      check(`request sends { type, id, data } (${JSON.stringify(sent)})`,
        sent.type === 'get_stats' && typeof sent.id === 'string' && (sent.data as { range: number }).range === 24);
      const seen: unknown[] = [];
      c.on('response', (d) => seen.push(d));
      c.on('message', (d) => seen.push(d));
      s.receive({ type: 'response', id: 'someone-else', data: 1 });
      s.receive({ type: 'response', id: sent.id, data: { kobolds: 3 } });
      const r = await outcome(p);
      check(`the reply with its id resolves with its data (${JSON.stringify(r)})`, r.ok && (r.value as { kobolds: number }).kobolds === 3);
      check(`a correlated reply is consumed; the uncorrelated one reached the handlers (${seen.length} dispatches)`, seen.length === 2);
      check('nothing is left pending', c.pendingRequests === 0);
    }

    // ── 2. Two in flight, answered out of order ──
    {
      const c = make();
      const s = connectFake(c);
      const a = c.request('a');
      const idA = s.lastSent().id;
      const b = c.request('b');
      const idB = s.lastSent().id;
      check('each request gets its own id', idA !== idB);
      s.receive({ type: 'response', id: idB, data: 'B' });
      s.receive({ type: 'response', id: idA, data: 'A' });
      const [ra, rb] = await Promise.all([outcome(a), outcome(b)]);
      check(`out-of-order replies reach the right callers (${ra.value}, ${rb.value})`, ra.value === 'A' && rb.value === 'B');
    }

    // ── 3. Error reply, timeout, close, disconnect, not open ──
    {
      const c = make();
      const s = connectFake(c);
      const p = c.request('bad');
      s.receive({ type: 'error', id: s.lastSent().id, error: 'Unknown command: bad' });
      const r = await outcome(p);
      check(`an error reply rejects with its message (${r.error})`, !r.ok && r.error === 'Unknown command: bad');

      const t = await outcome(c.request('slow', null, { timeoutMs: 80 }));
      check(`no reply in time rejects (${t.error})`, !t.ok && /timed out/.test(t.error ?? ''));
      check('a timed-out request is not left pending', c.pendingRequests === 0);

      const late = c.request('late', null, { timeoutMs: 80 });
      const lateId = s.lastSent().id;
      await outcome(late);
      const seen: unknown[] = [];
      c.on('response', (d) => seen.push(d));
      s.receive({ type: 'response', id: lateId, data: 'too late' });
      check('a reply after its timeout goes to the normal handlers, not to a settled promise', seen.length === 1);

      const onClose = c.request('x');
      s.drop();
      const rc = await outcome(onClose);
      check(`a socket close rejects pending requests (${rc.error})`, !rc.ok && /closed/.test(rc.error ?? ''));
    }
    {
      const c = make();
      connectFake(c);
      const p1 = c.request('x');
      const p2 = c.request('y');
      c.disconnect();
      const [r1, r2] = await Promise.all([outcome(p1), outcome(p2)]);
      check(`disconnect() rejects every pending request (${r1.error}, ${r2.error})`, !r1.ok && !r2.ok && c.pendingRequests === 0);
      const notOpen = await outcome(c.request('z'));
      check(`a request while not open rejects at once (${notOpen.error})`, !notOpen.ok && /not open/.test(notOpen.error ?? ''));
    }

    // ── 4. A configurable correlation field, and requestMessage for another envelope shape ──
    {
      const c = make({ requestIdField: 'requestId' });
      const s = connectFake(c);
      const p = c.requestMessage({ command: 'get_projects', data: null });
      const sent = s.lastSent();
      check(`requestMessage sends the body with the id under requestId (${JSON.stringify(sent)})`,
        sent.command === 'get_projects' && typeof sent.requestId === 'string' && !('id' in sent) && !('type' in sent));
      s.receive({ type: 'response', id: sent.requestId, data: 'wrong field' });
      s.receive({ type: 'response', requestId: sent.requestId, data: ['p1'] });
      const r = await outcome(p);
      check(`the reply is matched on requestId only (${JSON.stringify(r.value)})`, r.ok && JSON.stringify(r.value) === '["p1"]');
    }
    {
      const c = make();
      const s = connectFake(c);
      const p = c.request('cmd', null, { errorTypes: ['failure'] });
      s.receive({ type: 'failure', id: s.lastSent().id, message: 'nope' });
      const r = await outcome(p);
      check(`custom errorTypes reject, reading message (${r.error})`, !r.ok && r.error === 'nope');
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  clients.forEach((c) => c.disconnect());

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] ws-request-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ws-request-smoke ${r}`);
})();
