// TASK-581 — SyncManager re-sent a failing write every cycle forever. Now: exponential backoff persisted with the
// action, a retry cap that makes it `dead`, `dead` at once for a 4xx a retry cannot change, per-entity ordering around
// a write that is not getting through, and an API to list / retry / discard dead actions.
// A real ActionQueue on real IndexedDB (one database per case), a fake clock, and a fake ApiClient whose answer is
// set per path. Not a stubbed fetch: backport-smoke stubs the global fetch, and the suites run concurrently.
import { ActionQueue, SyncManager, type QueuedAction, type SyncManagerOptions, type ApiClient, type ApiResponse } from 'birko-web-core';

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

class FakeApi {
  /** Status per path; anything unset answers 200. A value of 'throw' makes the call reject. */
  answers = new Map<string, number | 'throw'>();
  sent: string[] = [];
  private async _send(method: Method, path: string): Promise<ApiResponse> {
    this.sent.push(`${method} ${path}`);
    const a = this.answers.get(path) ?? 200;
    if (a === 'throw') throw new Error('network down');
    return { ok: a >= 200 && a < 300, status: a, data: null, headers: new Headers() };
  }
  post(p: string) { return this._send('POST', p); }
  put(p: string) { return this._send('PUT', p); }
  patch(p: string) { return this._send('PATCH', p); }
  delete(p: string) { return this._send('DELETE', p); }
}

let dbSeq = 0;
async function setup(options: SyncManagerOptions = {}) {
  dbSeq += 1;
  const queue = new ActionQueue({ dbName: `pg_sync_retry_${dbSeq}_${Date.now()}` });
  await queue.clear();
  const api = new FakeApi();
  const clock = { t: 1_000_000 };
  const make = () => new SyncManager(queue, api as unknown as ApiClient,
    { syncInterval: 1_000_000_000, retryBaseMs: 1000, retryMaxMs: 4000, maxRetries: 4, now: () => clock.t, ...options });
  const mgr = make();
  const enqueue = (method: Method, path: string, entityId?: string) =>
    queue.enqueue({ method, path, body: {}, metadata: { moduleId: 'm', description: path, entityType: 'thing', entityId } });
  const find = async (id: string) => (await queue.getAll()).find((a) => a.id === id);
  return { queue, api, clock, mgr, make, enqueue, find };
}

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const managers: SyncManager[] = [];

  // Run after carousel-smoke: a burst of IndexedDB databases here made its timing-sensitive drag and autoplay checks
  // fail in 2 of 3 runs, and passed in every run with this wait.
  {
    const done = () => (window as unknown as { __carouselSmokeDone?: boolean }).__carouselSmokeDone === true;
    const deadline = Date.now() + 45_000;
    while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  }

  try {
    // ── 1. Backoff: doubling from retryBaseMs, capped at retryMaxMs, persisted, honoured across a reload ──
    {
      const s = await setup();
      managers.push(s.mgr);
      s.api.answers.set('a', 500);
      const id = await s.enqueue('PUT', 'a', 'a1');
      await s.mgr.sync();
      let a = await s.find(id);
      check(`a 500 leaves it failed with retries 1 (status ${a?.status}, retries ${a?.retries})`, a?.status === 'failed' && a.retries === 1);
      check(`the next attempt is retryBaseMs away (+${(a?.nextAttemptAt ?? 0) - s.clock.t})`, a?.nextAttemptAt === s.clock.t + 1000);

      s.clock.t += 999;
      await s.mgr.sync();
      check(`not re-sent before its time (sent ${s.api.sent.length})`, s.api.sent.length === 1);

      // A reload: a new SyncManager over the same queue still waits.
      const reloaded = s.make();
      managers.push(reloaded);
      await reloaded.sync();
      check('a reloaded SyncManager honours the persisted schedule', s.api.sent.length === 1);

      s.clock.t += 1;
      await reloaded.sync();
      a = await s.find(id);
      check(`re-sent once its time is up (sent ${s.api.sent.length})`, s.api.sent.length === 2);
      check(`the delay doubles (+${(a?.nextAttemptAt ?? 0) - s.clock.t})`, a?.nextAttemptAt === s.clock.t + 2000);

      s.clock.t += 2000;
      await reloaded.sync();
      a = await s.find(id);
      check(`and is capped at retryMaxMs (+${(a?.nextAttemptAt ?? 0) - s.clock.t}, retries ${a?.retries})`,
        a?.retries === 3 && a.nextAttemptAt === s.clock.t + 4000);
    }

    // ── 2. The cap: maxRetries attempts, then dead — reported once, out of the pending count ──
    {
      const s = await setup();
      managers.push(s.mgr);
      s.api.answers.set('b', 503);
      const id = await s.enqueue('POST', 'b');
      const deaths: QueuedAction[] = [];
      s.mgr.onDead((x) => deaths.push(x));
      let lastResult = { dead: 0 };
      for (let i = 0; i < 4; i++) { lastResult = await s.mgr.sync(); s.clock.t += 10_000; }
      const b = await s.find(id);
      check(`after maxRetries (4) attempts it is dead (status ${b?.status}, retries ${b?.retries})`, b?.status === 'dead' && b.retries === 4);
      check(`the sync that killed it reports dead: 1 (got ${lastResult.dead})`, lastResult.dead === 1);
      check(`onDead fired once, with the action (${deaths.length})`, deaths.length === 1 && deaths[0].id === id);
      check(`lastError is kept (${b?.lastError})`, b?.lastError === 'HTTP 503');
      check(`a dead action is not pending (pendingCount ${s.queue.pendingCount})`, s.queue.pendingCount === 0);
      const sentBefore = s.api.sent.length;
      s.clock.t += 10_000_000;
      await s.mgr.sync();
      check('a dead action is never re-sent by sync()', s.api.sent.length === sentBefore);
    }

    // ── 3. A response a retry cannot change: dead at once. Ones that can change: backoff ──
    {
      const cases: [Method, number, 'dead' | 'failed' | 'gone' | 'conflict'][] = [
        ['POST', 422, 'dead'], ['PUT', 400, 'dead'], ['PATCH', 403, 'dead'], ['PUT', 404, 'dead'], ['POST', 413, 'dead'],
        ['POST', 401, 'failed'], ['POST', 408, 'failed'], ['POST', 429, 'failed'], ['POST', 500, 'failed'],
        ['POST', 409, 'conflict'], ['DELETE', 404, 'gone'],
      ];
      for (const [method, status, expected] of cases) {
        const s = await setup();
        managers.push(s.mgr);
        s.api.answers.set('c', status);
        const id = await s.enqueue(method, 'c');
        await s.mgr.sync();
        const c = await s.find(id);
        const got = c ? c.status : 'gone';
        check(`${method} ${status} → ${expected} (got ${got}${c ? `, retries ${c.retries}` : ''})`, got === expected);
      }
      // deleteMissingIsApplied: false says this API's DELETE 404 is retryable — so it is not dead.
      const s = await setup({ deleteMissingIsApplied: false });
      managers.push(s.mgr);
      s.api.answers.set('c', 404);
      const id = await s.enqueue('DELETE', 'c');
      await s.mgr.sync();
      check('with deleteMissingIsApplied: false a DELETE 404 backs off rather than dying', (await s.find(id))?.status === 'failed');
    }
    {
      const s = await setup();
      managers.push(s.mgr);
      s.api.answers.set('t', 'throw');
      const id = await s.enqueue('POST', 't');
      await s.mgr.sync();
      const t = await s.find(id);
      check(`a thrown request backs off (status ${t?.status}, lastError ${t?.lastError})`,
        t?.status === 'failed' && t.lastError === 'network down' && t.nextAttemptAt === s.clock.t + 1000);
    }

    // ── 4. Ordering: a write that is not getting through holds later writes to its entity, not to others ──
    {
      const s = await setup();
      managers.push(s.mgr);
      s.api.answers.set('x/1', 500);
      const a = await s.enqueue('PUT', 'x/1', 'x');
      const b = await s.enqueue('PUT', 'x/2', 'x');
      const c = await s.enqueue('PUT', 'y/1', 'y');
      await s.mgr.sync();
      check(`a failing write holds the next write to its entity, and the other entity goes ahead (sent: ${s.api.sent.join(', ')})`,
        s.api.sent.join() === 'PUT x/1,PUT y/1');
      check('the held write is still queued and untouched', (await s.find(b))?.status === 'pending');
      check('the other entity\'s write drained', !(await s.find(c)));

      s.clock.t += 500; // a backing-off write holds its entity too
      await s.mgr.sync();
      check('while it backs off, the next write to its entity still waits', s.api.sent.length === 2);

      s.api.answers.set('x/1', 422); // now it dies
      s.clock.t += 10_000;
      await s.mgr.sync();
      check('it dies on a 422', (await s.find(a))?.status === 'dead');
      check('the write behind it still waits behind a dead one', (await s.find(b))?.status === 'pending' && s.api.sent.length === 3);
      check(`getDead() lists it (${(await s.mgr.getDead()).map((d) => d.path).join()})`, (await s.mgr.getDead()).map((d) => d.id).join() === a);

      // Discard the dead one: the write behind it is sent on the next sync.
      check('discard() drops it', await s.mgr.discard(a));
      check('discard() of an unknown id is false', !(await s.mgr.discard('nope')));
      await s.mgr.sync();
      check(`after the discard the held write is sent (sent: ${s.api.sent.join(', ')})`, s.api.sent.at(-1) === 'PUT x/2' && !(await s.find(b)));
    }
    {
      // An action without entityId is keyed by its path.
      const s = await setup();
      managers.push(s.mgr);
      s.api.answers.set('orders', 500);
      await s.enqueue('POST', 'orders');
      await s.enqueue('POST', 'orders');
      await s.enqueue('POST', 'invoices');
      await s.mgr.sync();
      check(`without entityId, writes to the same path keep their order (sent: ${s.api.sent.join(', ')})`,
        s.api.sent.join() === 'POST orders,POST invoices');
    }

    // ── 5. retry(): a dead action goes back in line with a fresh schedule and the full budget ──
    {
      const s = await setup();
      managers.push(s.mgr);
      s.api.answers.set('r', 422);
      const id = await s.enqueue('PUT', 'r', 'r');
      await s.mgr.sync();
      check('precondition: it is dead', (await s.find(id))?.status === 'dead');
      check('retry() returns true', await s.mgr.retry(id));
      const r = await s.find(id);
      check(`retry() resets it (status ${r?.status}, retries ${r?.retries}, next ${r?.nextAttemptAt})`,
        r?.status === 'pending' && r.retries === 0 && r.nextAttemptAt === undefined);
      check('it counts as pending again', s.queue.pendingCount === 1);
      s.api.answers.set('r', 200);
      await s.mgr.sync();
      check('the next sync sends it and it drains', !(await s.find(id)) && s.api.sent.length === 2);
      check('retry() of an unknown id is false', !(await s.mgr.retry('nope')));
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  managers.forEach((m) => m.dispose());

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] sync-retry-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] sync-retry-smoke ${r}`);
})();
