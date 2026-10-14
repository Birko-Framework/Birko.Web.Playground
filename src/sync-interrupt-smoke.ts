// TASK-598 — SyncManager stores `syncing` before it sends an action and rewrites it only when the request settles, so
// a tab closed mid-request left the action `syncing` forever: never resent, not counted, not listed, not holding its
// entity. Now a sync recovers it: PUT, DELETE and an idPinned POST are resent (a replay that already landed reads as
// applied), a plain POST or a PATCH is made `dead` for the user to decide, since resending could apply it twice.
// Only one tab drains at a time (Web Locks); without Web Locks a `syncingSince` lease decides that a `syncing` action
// was abandoned. A "reload" here is a stored `syncing` action and a fresh SyncManager over the same queue.
import { ActionQueue, SyncManager, type SyncManagerOptions, type ApiClient, type ApiResponse } from 'birko-web-core';

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

class FakeApi {
  /** Status per path; anything unset answers 200. */
  answers = new Map<string, number>();
  /** Paths whose request waits until `release()`. */
  gated = new Set<string>();
  sent: string[] = [];
  private _open: (() => void)[] = [];
  release() { this._open.splice(0).forEach((f) => f()); }
  private async _send(method: Method, path: string): Promise<ApiResponse> {
    this.sent.push(`${method} ${path}`);
    if (this.gated.has(path)) await new Promise<void>((r) => this._open.push(r));
    const a = this.answers.get(path) ?? 200;
    return { ok: a >= 200 && a < 300, status: a, data: null, headers: new Headers() };
  }
  post(p: string) { return this._send('POST', p); }
  put(p: string) { return this._send('PUT', p); }
  patch(p: string) { return this._send('PATCH', p); }
  delete(p: string) { return this._send('DELETE', p); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dbSeq = 0;
async function setup(options: SyncManagerOptions = {}) {
  dbSeq += 1;
  const dbName = `pg_sync_interrupt_${dbSeq}_${Date.now()}`;
  const queue = new ActionQueue({ dbName });
  await queue.clear();
  const api = new FakeApi();
  const clock = { t: 1_000_000 };
  const make = (extra: SyncManagerOptions = {}) => new SyncManager(queue, api as unknown as ApiClient,
    { syncInterval: 1_000_000_000, retryBaseMs: 1000, retryMaxMs: 4000, maxRetries: 4, now: () => clock.t, ...options, ...extra });
  const enqueue = (method: Method, path: string, entityId: string, idPinned = false) =>
    queue.enqueue({ method, path, body: {}, metadata: { moduleId: 'm', description: path, entityType: 'thing', entityId, idPinned } });
  const find = async (id: string) => (await queue.getAll()).find((a) => a.id === id);
  /** What a tab closed mid-request leaves behind. */
  const strand = async (id: string, retries: number, syncingSince?: number) => {
    const a = (await find(id))!;
    a.status = 'syncing';
    a.retries = retries;
    a.syncingSince = syncingSince;
    await queue.update(a);
  };
  return { dbName, queue, api, clock, make, enqueue, find, strand };
}

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const managers: SyncManager[] = [];

  // Same reason as sync-retry-smoke: a burst of IndexedDB databases disturbs carousel-smoke's timing checks.
  {
    const done = () => (window as unknown as { __carouselSmokeDone?: boolean }).__carouselSmokeDone === true;
    const deadline = Date.now() + 45_000;
    while (!done() && Date.now() < deadline) await sleep(50);
  }

  try {
    // ── 1. A reload finds a stranded action: counted, and the safe methods are resent ──
    {
      const s = await setup();
      const put = await s.enqueue('PUT', 'p', 'p1');
      const del = await s.enqueue('DELETE', 'd', 'd1');
      const pin = await s.enqueue('POST', 'c', 'c1', true);
      await s.strand(put, 2);
      await s.strand(del, 0);
      await s.strand(pin, 0);
      s.api.answers.set('d', 404);   // it had landed: the row is gone
      s.api.answers.set('c', 409);   // it had landed: its pinned id exists

      const reloaded = new ActionQueue({ dbName: s.dbName });
      const deadline = Date.now() + 2000;
      while (reloaded.pendingCount !== 3 && Date.now() < deadline) await sleep(20);
      check(`a reload counts the stranded writes as pending (${reloaded.pendingCount})`, reloaded.pendingCount === 3);

      const mgr = s.make();
      managers.push(mgr);
      const r = await mgr.sync();
      check(`PUT, DELETE and the idPinned POST are resent (${s.api.sent.join(', ')})`,
        s.api.sent.length === 3 && ['PUT p', 'DELETE d', 'POST c'].every((x) => s.api.sent.includes(x)));
      check(`each reads as applied and leaves the queue (synced ${r.synced}, left ${(await s.queue.getAll()).length})`,
        r.synced === 3 && (await s.queue.getAll()).length === 0);
    }

    // ── 2. Its retry count is kept, and a failed resend backs off as usual ──
    {
      const s = await setup();
      const id = await s.enqueue('PUT', 'p', 'p1');
      await s.strand(id, 2);
      s.api.answers.set('p', 500);
      const mgr = s.make();
      managers.push(mgr);
      await mgr.sync();
      const a = await s.find(id);
      check(`a failed resend counts from the kept retries (status ${a?.status}, retries ${a?.retries})`,
        a?.status === 'failed' && a.retries === 3);
      check(`…and backs off from there (+${(a?.nextAttemptAt ?? 0) - s.clock.t})`, a?.nextAttemptAt === s.clock.t + 4000);
    }

    // ── 3. A plain POST or a PATCH may have landed: dead, for the user, never resent ──
    {
      const s = await setup();
      const post = await s.enqueue('POST', 'n', 'n1');
      const patch = await s.enqueue('PATCH', 'm', 'm1');
      const later = await s.enqueue('PUT', 'n-later', 'n1');   // same entity as the stranded POST
      await s.strand(post, 1);
      await s.strand(patch, 0);
      const mgr = s.make();
      managers.push(mgr);
      const deadSeen: string[] = [];
      mgr.onDead((a) => deadSeen.push(a.id));
      const r = await mgr.sync();
      const p = await s.find(post);
      const m = await s.find(patch);
      check(`neither is resent (sent: ${s.api.sent.join(', ') || 'nothing'})`,
        !s.api.sent.includes('POST n') && !s.api.sent.includes('PATCH m'));
      check(`both are dead (${p?.status}, ${m?.status}; result dead ${r.dead})`, p?.status === 'dead' && m?.status === 'dead' && r.dead === 2);
      check(`lastError says it may have been applied (${JSON.stringify(p?.lastError)})`, /may have been applied/.test(p?.lastError ?? ''));
      check(`its retry count is kept (${p?.retries})`, p?.retries === 1);
      check(`onDead fired once for each (${deadSeen.length})`, deadSeen.length === 2 && deadSeen.includes(post) && deadSeen.includes(patch));
      check(`getDead lists them (${(await mgr.getDead()).length})`, (await mgr.getDead()).length === 2);
      check(`a later write to the same entity waits behind it (sent: ${s.api.sent.join(', ') || 'nothing'})`,
        !s.api.sent.includes('PUT n-later') && (await s.find(later))?.status === 'pending');
    }

    // ── 4. Two managers on one queue (two tabs): every action is sent exactly once ──
    {
      const s = await setup();
      await s.enqueue('PUT', 'a', 'a1');
      await s.enqueue('PUT', 'b', 'b1');
      s.api.gated.add('a');
      const tabA = s.make();
      const tabB = s.make();
      managers.push(tabA, tabB);
      const syncA = tabA.sync();
      const deadline = Date.now() + 2000;
      while (!s.api.sent.length && Date.now() < deadline) await sleep(10);
      const inFlight = (await s.queue.getAll()).find((a) => a.path === 'a');
      check(`an in-flight action records when it started (${inFlight?.status}, syncingSince ${inFlight?.syncingSince})`,
        inFlight?.status === 'syncing' && inFlight.syncingSince === s.clock.t);
      const rB = await tabB.sync();
      check(`the second tab sends nothing while the first is draining (sent: ${s.api.sent.join(', ')})`, s.api.sent.length === 1);
      check(`…and does not reclaim the first tab's in-flight action (result ${JSON.stringify(rB)})`,
        rB.synced === 0 && rB.dead === 0 && (await s.queue.getAll()).find((a) => a.path === 'a')?.status === 'syncing');
      s.api.release();
      await syncA;
      await tabB.sync();
      check(`each action was sent exactly once (${s.api.sent.join(', ')})`,
        s.api.sent.length === 2 && s.api.sent.filter((x) => x === 'PUT a').length === 1 && s.api.sent.filter((x) => x === 'PUT b').length === 1);
      check(`the queue is empty (${(await s.queue.getAll()).length})`, (await s.queue.getAll()).length === 0);
    }

    // ── 5. No Web Locks: a lease decides when a `syncing` action is abandoned ──
    {
      const s = await setup({ locks: null, syncLeaseMs: 5000 });
      const live = await s.enqueue('PUT', 'l', 'l1');
      const later = await s.enqueue('PUT', 'l-later', 'l1');
      const old = await s.enqueue('PUT', 'o', 'o1');
      await s.strand(live, 0, s.clock.t - 1000);   // another tab started it a second ago
      await s.strand(old);                          // written by a version that kept no timestamp
      const mgr = s.make();
      managers.push(mgr);
      await mgr.sync();
      check(`a syncing action inside its lease is left alone (sent: ${s.api.sent.join(', ') || 'nothing'})`,
        !s.api.sent.includes('PUT l') && (await s.find(live))?.status === 'syncing');
      check('…and holds its entity: a later write to it waits', !s.api.sent.includes('PUT l-later'));
      check('one with no timestamp is treated as abandoned and resent', s.api.sent.includes('PUT o'));
      s.clock.t += 4000;
      await mgr.sync();
      check(`once the lease is up it is reclaimed and resent, in order (sent: ${s.api.sent.join(', ')})`,
        s.api.sent.join(',') === 'PUT o,PUT l,PUT l-later');
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  managers.forEach((m) => m.dispose());

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] sync-interrupt-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] sync-interrupt-smoke ${r}`);
})();
