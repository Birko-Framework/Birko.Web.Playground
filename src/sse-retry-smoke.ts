// TASK-547 — SseClient owns ONE retry loop with a growing delay schedule and a "failing" signal. Before, an error
// scheduled a timer while the native EventSource (already CONNECTING) retried on its own; when the native retry won,
// the timer closed the healthy connection and opened another. A fake EventSource replaces the global for the run
// (no other suite opens one); delays are read by wrapping setTimeout around the synchronous error dispatch only, and
// the captured retry is run at once, so nothing waits real seconds.
import { SseClient, type SseFailing } from 'birko-web-core';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  closed = false;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(): void { /* named events are not exercised here */ }
  close(): void { this.closed = true; this.readyState = FakeEventSource.CLOSED; }
  open(): void { this.readyState = FakeEventSource.OPEN; this.onopen?.(new Event('open')); }
  /** A transient drop: the native source stays CONNECTING (and would retry itself) unless closed. */
  fail(): void { this.readyState = FakeEventSource.CONNECTING; this.onerror?.(new Event('error')); }
}

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, got: unknown, want: unknown) =>
    check(`${name} (${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

  const realEventSource = window.EventSource;
  const realSetTimeout = window.setTimeout;
  const wait = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));
  const clients: SseClient[] = [];
  const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];
  const live = () => FakeEventSource.instances.filter((s) => !s.closed).length;

  /** Fail the current source; returns the retry delay it scheduled (null: none) and runs that retry now. */
  const failNow = async (): Promise<number | null> => {
    let captured: number | null = null;
    (window as { setTimeout: unknown }).setTimeout = (fn: () => void, ms?: number) => {
      captured = ms ?? 0;
      return realSetTimeout(fn, 0);
    };
    try { latest().fail(); } finally { window.setTimeout = realSetTimeout; }
    await wait(5);
    return captured;
  };
  const make = (opts: Partial<ConstructorParameters<typeof SseClient>[0]> = {}) => {
    const c = new SseClient({ url: '/sse/test', ...opts });
    clients.push(c);
    return c;
  };

  (window as { EventSource: unknown }).EventSource = FakeEventSource;
  try {
    // ── one retry loop ──
    {
      FakeEventSource.instances = [];
      const c = make({ reconnectMs: 40 });
      c.connect();
      const first = latest();
      first.open();
      first.fail();
      check('on error the native source is closed, so it cannot retry alongside the client', first.closed);
      eq('state reads "connecting" while a retry is pending', c.state, 'connecting');
      eq('no second connection while the retry is pending', FakeEventSource.instances.length, 1);
      await wait(90);
      eq('the retry opens exactly one new connection', FakeEventSource.instances.length, 2);
      eq('…and exactly one connection is live', live(), 1);
      c.disconnect();
    }

    // ── the old bug's race: the native retry would have won, then the timer killed it ──
    {
      FakeEventSource.instances = [];
      const c = make({ reconnectMs: 40 });
      c.connect();
      latest().open();
      const first = latest();
      first.fail();
      const nativeRecovered = !first.closed; // only a source left open can retry natively
      if (nativeRecovered) first.open();
      await wait(90);
      check('a pending retry never closes a connection the native source recovered', !(nativeRecovered && first.closed));
      eq('…and one connection is live', live(), 1);
      c.disconnect();
    }

    // ── the default schedule, reset on open ──
    {
      FakeEventSource.instances = [];
      const c = make();
      c.connect();
      latest().open();
      const delays: (number | null)[] = [];
      for (let i = 0; i < 5; i++) delays.push(await failNow());
      eq('default delays grow and the last repeats', delays, [5000, 10000, 30000, 60000, 60000]);
      eq('failures are counted', c.failures, 5);
      latest().open();
      eq('an open resets the count', c.failures, 0);
      eq('…and the next failure starts the schedule again', await failNow(), 5000);
      c.disconnect();
    }

    // ── a custom schedule ──
    {
      FakeEventSource.instances = [];
      const c = make({ reconnectDelays: [100, 200] });
      c.connect();
      eq('reconnectDelays: first', await failNow(), 100);
      eq('reconnectDelays: second', await failNow(), 200);
      eq('reconnectDelays: the last repeats', await failNow(), 200);
      c.disconnect();
    }

    // ── reconnectMs keeps its old meaning ──
    {
      FakeEventSource.instances = [];
      const c = make({ reconnectMs: 5000 });
      c.connect();
      const delays = [await failNow(), await failNow(), await failNow()];
      eq('reconnectMs is one fixed delay, as before', delays, [5000, 5000, 5000]);
      c.disconnect();

      FakeEventSource.instances = [];
      const off = make({ reconnectMs: 0 });
      off.connect();
      eq('reconnectMs: 0 schedules no retry', await failNow(), null);
      eq('…and opens no new connection', FakeEventSource.instances.length, 1);
      eq('…and the state is closed', off.state, 'closed');
    }

    // ── the failing signal ──
    {
      FakeEventSource.instances = [];
      const c = make();
      const fired: SseFailing[] = [];
      c.on('_failing', (d) => fired.push(d as SseFailing));
      c.connect();
      for (let i = 0; i < 7; i++) await failNow();
      eq('_failing fires once, at the 5th consecutive failure', fired, [{ failures: 5, nextDelayMs: 60000 }]);
      let reconnected = 0;
      c.on('_reconnect', () => reconnected++);
      latest().open();
      // connect() never opened before the failures, so this first open is not a "re"connect
      eq('recovery: _reconnect stays the signal (not fired on a first-ever open)', reconnected, 0);
      for (let i = 0; i < 5; i++) await failNow();
      eq('after an open, a new outage fires _failing again', fired.length, 2);
      latest().open();
      eq('…and recovery fires _reconnect', reconnected, 1);
      c.disconnect();

      FakeEventSource.instances = [];
      const two = make({ failingAfter: 2, reconnectDelays: [10] });
      const twoFired: SseFailing[] = [];
      two.on('_failing', (d) => twoFired.push(d as SseFailing));
      two.connect();
      await failNow(); await failNow(); await failNow();
      eq('failingAfter sets the threshold', twoFired, [{ failures: 2, nextDelayMs: 10 }]);
      two.disconnect();

      FakeEventSource.instances = [];
      const never = make({ failingAfter: 0 });
      let neverFired = 0;
      never.on('_failing', () => neverFired++);
      never.connect();
      for (let i = 0; i < 6; i++) await failNow();
      eq('failingAfter: 0 never fires', neverFired, 0);
      never.disconnect();
    }

    // ── disconnect / connect ──
    {
      FakeEventSource.instances = [];
      const c = make({ reconnectMs: 40 });
      c.connect();
      latest().fail();
      c.disconnect();
      await wait(90);
      eq('disconnect cancels the pending retry', FakeEventSource.instances.length, 1);
      eq('…and the state is closed', c.state, 'closed');

      FakeEventSource.instances = [];
      const d = make({ reconnectDelays: [100, 200, 300] });
      d.connect();
      await failNow(); await failNow();
      d.disconnect();
      d.connect();
      eq('connect() after disconnect() starts the schedule fresh', await failNow(), 100);
      d.disconnect();
    }

    // ── refused configurations ──
    const refuses = (name: string, opts: Partial<ConstructorParameters<typeof SseClient>[0]>) => {
      let threw = false;
      try { new SseClient({ url: '/x', ...opts }); } catch (e) { threw = e instanceof TypeError; }
      check(name, threw);
    };
    refuses('reconnectMs and reconnectDelays together are refused', { reconnectMs: 1000, reconnectDelays: [1000] });
    refuses('an empty schedule is refused', { reconnectDelays: [] });
    refuses('a negative delay is refused', { reconnectDelays: [1000, -1] });
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  } finally {
    for (const c of clients) c.disconnect();
    (window as { EventSource: unknown }).EventSource = realEventSource;
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] sse-retry-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] sse-retry-smoke ${r}`);
})();
