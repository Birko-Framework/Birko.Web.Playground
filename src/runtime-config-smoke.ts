// TASK-526 — RuntimeConfig: defaults < server < local, change notification, declared keys and types only, and secrets
// never written to storage (a copy an older build wrote is scrubbed). A fake Storage and a fake server fetch.
import { RuntimeConfig } from 'birko-web-core';

class FakeStorage implements Storage {
  map = new Map<string, string>();
  writes = 0;
  failWrites = false;
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { if (this.failWrites) throw new Error('QuotaExceeded'); this.writes++; this.map.set(k, v); }
}

const defaults = { serverUrl: 'ws://default', refreshMs: 5000, theme: 'light', authToken: '' };
type Cfg = typeof defaults;

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const KEY = 'pg-runtime-config';

  try {
    // ── 1. Merge order ──
    {
      const storage = new FakeStorage();
      storage.setItem(KEY, JSON.stringify({ theme: 'dark' }));
      let serverAnswer: Partial<Cfg> | null = { serverUrl: 'wss://server', theme: 'server-theme', refreshMs: 1000 };
      const cfg = new RuntimeConfig<Cfg>({ defaults, storageKey: KEY, storage, fetchServer: async () => serverAnswer, secretKeys: ['authToken'] });
      check(`before load: defaults, then local (theme ${cfg.get().theme}, url ${cfg.get().serverUrl})`,
        cfg.get().theme === 'dark' && cfg.get().serverUrl === 'ws://default');
      const changes: Cfg[] = [];
      const un = cfg.onChange((c) => changes.push(c));
      check('load() resolves true', await cfg.load());
      const c = cfg.get();
      check(`server overrides defaults (url ${c.serverUrl}, refresh ${c.refreshMs})`, c.serverUrl === 'wss://server' && c.refreshMs === 1000);
      check(`local overrides server (theme ${c.theme})`, c.theme === 'dark');
      check(`load notifies (${changes.length})`, changes.length === 1 && changes[0].serverUrl === 'wss://server');

      cfg.set({ serverUrl: 'wss://mine' });
      check(`set() overrides and notifies (url ${cfg.get().serverUrl}, ${changes.length})`, cfg.get().serverUrl === 'wss://mine' && changes.length === 2);
      serverAnswer = { serverUrl: 'wss://server-2' };
      await cfg.load();
      check(`a later server load does not clobber a local choice (${cfg.get().serverUrl})`, cfg.get().serverUrl === 'wss://mine');
      cfg.reset(['serverUrl']);
      check(`reset(key) shows the server value again (${cfg.get().serverUrl})`, cfg.get().serverUrl === 'wss://server-2');
      cfg.reset();
      check(`reset() drops every local value (theme ${cfg.get().theme})`, cfg.get().theme === 'light');
      un();
      cfg.set({ theme: 'x' });
      check('after unsubscribe no more notifications', changes.length === 5);

      const g = cfg.get();
      g.theme = 'mutated';
      check('get() returns a copy', cfg.get().theme === 'x');
    }

    // ── 2. Persistence: only the local layer, never the server's values ──
    {
      const storage = new FakeStorage();
      const cfg = new RuntimeConfig<Cfg>({ defaults, storageKey: KEY, storage, fetchServer: async () => ({ refreshMs: 1 }) });
      await cfg.load();
      cfg.set({ theme: 'dark' });
      const stored = JSON.parse(storage.getItem(KEY)!);
      check(`storage holds the local layer only (${JSON.stringify(stored)})`, JSON.stringify(stored) === '{"theme":"dark"}');
      const reloaded = new RuntimeConfig<Cfg>({ defaults, storageKey: KEY, storage });
      check('a new instance reads the local layer back', reloaded.get().theme === 'dark');
    }

    // ── 3. Secrets ──
    {
      const storage = new FakeStorage();
      const cfg = new RuntimeConfig<Cfg>({ defaults, storageKey: KEY, storage, secretKeys: ['authToken'] });
      cfg.set({ authToken: 'tok-123', theme: 'dark' });
      check('a secret set locally is used', cfg.get().authToken === 'tok-123');
      check(`a secret is never written to storage (${storage.getItem(KEY)})`, !storage.getItem(KEY)!.includes('tok-123'));

      const old = new FakeStorage();
      old.setItem(KEY, JSON.stringify({ authToken: 'leaked', theme: 'dark' }));
      const scrubbed = new RuntimeConfig<Cfg>({ defaults, storageKey: KEY, storage: old, secretKeys: ['authToken'] });
      check(`a secret an older build stored is ignored (${scrubbed.get().authToken === '' ? 'empty' : scrubbed.get().authToken})`, scrubbed.get().authToken === '');
      check(`…and scrubbed from storage (${old.getItem(KEY)})`, !old.getItem(KEY)!.includes('leaked') && scrubbed.get().theme === 'dark');
      const server = new RuntimeConfig<Cfg>({ defaults, secretKeys: ['authToken'], fetchServer: async () => ({ authToken: 'from-server' }) });
      await server.load();
      check('a secret may still come from the server (in memory)', server.get().authToken === 'from-server');
    }

    // ── 4. Declared keys and types only ──
    {
      const storage = new FakeStorage();
      storage.setItem(KEY, JSON.stringify({ refreshMs: 'fast', unknownKey: 1, __proto__: { polluted: true } }));
      const cfg = new RuntimeConfig<Cfg>({ defaults, storageKey: KEY, storage, fetchServer: async () => ({ serverUrl: 42, extra: 'x' } as never) });
      await cfg.load();
      const c = cfg.get() as Record<string, unknown>;
      check(`a stored value of the wrong type is ignored (refreshMs ${c.refreshMs})`, c.refreshMs === 5000);
      check(`a server value of the wrong type is ignored (serverUrl ${c.serverUrl})`, c.serverUrl === 'ws://default');
      check('undeclared keys are ignored from both layers', !('unknownKey' in c) && !('extra' in c) && !('polluted' in c));
    }

    // ── 5. Failure is non-fatal ──
    {
      const fails = new RuntimeConfig<Cfg>({ defaults, fetchServer: async () => { throw new Error('down'); } });
      check('a throwing server read → load() false, defaults kept', !(await fails.load()) && fails.get().serverUrl === 'ws://default');
      const nul = new RuntimeConfig<Cfg>({ defaults, fetchServer: async () => null });
      check('a null server answer → load() false', !(await nul.load()));
      const none = new RuntimeConfig<Cfg>({ defaults });
      check('no server configured → load() false', !(await none.load()));
      const bad = new FakeStorage();
      bad.setItem(KEY, '{not json');
      check('unparseable storage → defaults', new RuntimeConfig<Cfg>({ defaults, storageKey: KEY, storage: bad }).get().theme === 'light');
      const full = new FakeStorage();
      full.failWrites = true;
      const realWarn = console.warn;
      console.warn = () => {};
      const cfg = new RuntimeConfig<Cfg>({ defaults, storageKey: KEY, storage: full });
      cfg.set({ theme: 'dark' });
      console.warn = realWarn;
      check('a storage write that throws keeps the value in memory', cfg.get().theme === 'dark');
      const mem = new RuntimeConfig<Cfg>({ defaults });
      mem.set({ theme: 'dark' });
      check('without a storageKey the local layer is memory only', mem.get().theme === 'dark');
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] runtime-config-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] runtime-config-smoke ${r}`);
})();
