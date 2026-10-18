// TASK-524 — OAuth redirect sign-in helpers in birko-web-shell: readAuthFragment parses and clears an auth fragment,
// tokenExpiresAt reads a JWT's exp (base64url), createAuthSession refreshes ahead of expiry, after a 401 and after a
// network failure, through one pluggable refresh call, and the store's token is what ApiClient and SseClient send.
// Timers and the clock are injected, so nothing waits real time; fetch and EventSource are faked for the run.
import { ApiClient, SseClient } from 'birko-web-core';
import { createAuthStore, createAuthSession, readAuthFragment, tokenExpiresAt, decodeJwtPayload } from 'birko-web-shell';

const b64url = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: Record<string, unknown>) => `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.sig`;

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, got: unknown, want: unknown) =>
    check(`${name} (${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
  const keys: string[] = [];
  const newAuth = () => { const key = `auth-session-smoke-${keys.length}`; keys.push(key); return createAuthStore({ storageKey: key }); };
  const realFetch = window.fetch;
  const realEventSource = window.EventSource;

  try {
    // ── readAuthFragment ──
    const replaced: string[] = [];
    const history = { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaced.push(String(url)); } };
    const at = (hash: string) => ({ hash, pathname: '/app', search: '?x=1' });
    const access = jwt({ sub: 'github:42', exp: 2_000_000_000 });

    eq('a fragment is parsed', readAuthFragment(at(`#access_token=${access}&refresh_token=r1&expires_in=3600&token_type=Bearer`), history),
      { accessToken: access, refreshToken: 'r1', expiresIn: 3600 });
    eq('and cleared from the address bar, keeping path and query', replaced, ['/app?x=1']);
    replaced.length = 0;
    eq('a hash route is not an auth fragment', readAuthFragment(at('#/orders/5'), history), null);
    eq('a fragment without access_token is not one either', readAuthFragment(at('#section=2'), history), null);
    eq('and neither is touched', replaced, []);
    eq('a refused sign-in returns null', readAuthFragment(at('#error=access_denied'), history), null);
    eq('and its fragment is cleared', replaced, ['/app?x=1']);
    eq('no hash at all', readAuthFragment(at(''), history), null);

    // ── JWT payload and expiry ──
    // '~~~' and '???' encode to base64 '+' and '/', i.e. base64url '-' and '_': a bare atob() throws on them.
    const urlSafe = jwt({ sub: '~~~???', exp: 1_900_000_000, email: 'a@b.c' });
    check('the payload segment really contains a base64url-only character', /[-_]/.test(urlSafe.split('.')[1]));
    eq('tokenExpiresAt reads exp as epoch ms', tokenExpiresAt(urlSafe), 1_900_000_000_000);
    eq('an opaque token has no expiry', tokenExpiresAt('opaque-token'), null);
    eq('a token without exp has none', tokenExpiresAt(jwt({ sub: 'x' })), null);
    eq('a malformed payload decodes to null', decodeJwtPayload('a.!!!.c'), null);
    const decoding = newAuth();
    decoding.setAuth({ accessToken: urlSafe });
    eq('setAuth reads claims from a base64url payload', decoding.store.get('email'), 'a@b.c');

    // ── createAuthSession: schedule ──
    let clock = 1_000_000;
    const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
    const fake = {
      now: () => clock,
      setTimer: (fn: () => void, ms: number) => { const t = { fn, ms, cancelled: false }; timers.push(t); return t; },
      clearTimer: (h: unknown) => { (h as { cancelled: boolean }).cancelled = true; },
    };
    const pending = () => timers.filter((t) => !t.cancelled);
    const fire = async () => { const t = pending().pop(); if (!t) return false; t.cancelled = true; t.fn(); await new Promise((r) => setTimeout(r, 0)); return true; };
    const tokenFor = (minutes: number, n: number) => jwt({ sub: 'u', n, exp: Math.floor((clock + minutes * 60_000) / 1000) });

    const auth = newAuth();
    auth.setAuth({ accessToken: tokenFor(10, 1), refreshToken: 'rt-1' });
    const calls: string[] = [];
    let answer: () => Promise<{ accessToken: string; refreshToken?: string } | null> =
      async () => ({ accessToken: tokenFor(10, 2), refreshToken: 'rt-2' });
    let ended = 0;
    const session = createAuthSession({
      auth, leadMs: 60_000, retryMs: 5_000, onSessionEnded: () => { ended++; }, ...fake,
      refresh: (rt) => { calls.push(rt); return answer(); },
    });
    session.start();
    eq('the refresh is scheduled lead ms before exp', pending().map((t) => t.ms), [9 * 60_000]);

    clock += 9 * 60_000;
    await fire();
    eq('it refreshes with the stored refresh token', calls, ['rt-1']);
    eq('the store holds the new tokens', [decodeJwtPayload(auth.store.get('token')!)?.n, auth.store.get('refreshToken')], [2, 'rt-2']);
    eq('and the next refresh is scheduled from the new exp', pending().map((t) => t.ms), [9 * 60_000]);
    eq('getToken returns what the store holds', session.getToken(), auth.store.get('token'));

    // non-rotated: the old refresh token is kept
    answer = async () => ({ accessToken: tokenFor(10, 3) });
    clock += 9 * 60_000;
    await fire();
    eq('a refresh without a new refresh token keeps the old one', auth.store.get('refreshToken'), 'rt-2');

    // network failure: kept, retried after retryMs
    answer = async () => { throw new Error('offline'); };
    clock += 9 * 60_000;
    await fire();
    eq('a rejected refresh keeps the session', auth.store.get('isAuthenticated'), true);
    eq('and retries after retryMs', pending().map((t) => t.ms), [5_000]);

    // single flight
    let release!: () => void;
    answer = () => new Promise((r) => { release = () => r({ accessToken: tokenFor(10, 4), refreshToken: 'rt-4' }); });
    calls.length = 0;
    const first = session.refreshNow();
    const second = session.onRefreshToken();
    release();
    const [a, b] = await Promise.all([first, second]);
    eq('concurrent refreshes share one call', [calls.length, a === b], [1, true]);

    // a long-lived token: the capped wait re-waits instead of refreshing early
    auth.setAuth({ accessToken: tokenFor(60 * 24 * 60, 5), refreshToken: 'rt-5' });
    eq('a delay beyond setTimeout\'s range is capped', pending().map((t) => t.ms), [2_147_483_647]);
    calls.length = 0;
    clock += 2_147_483_647;
    await fire();
    eq('and when it ends early it waits again rather than refreshing', [calls.length, pending().length], [0, 1]);

    // refused: the session ends
    answer = async () => null;
    eq('a refused refresh resolves null', await session.refreshNow(), null);
    eq('and clears the store and reports the end once', [auth.store.get('isAuthenticated'), auth.store.get('token'), ended], [false, null, 1]);
    eq('and nothing stays scheduled', pending().length, 0);
    session.stop();

    // no refresh token: nothing to schedule or call
    const bare = newAuth();
    bare.setAuth({ accessToken: tokenFor(10, 6) });
    const bareCalls: string[] = [];
    const bareSession = createAuthSession({ auth: bare, ...fake, refresh: async (rt) => { bareCalls.push(rt); return null; } });
    const before = pending().length;
    bareSession.start();
    eq('without a refresh token nothing is scheduled', pending().length, before);
    eq('and refreshNow resolves null without calling refresh', [await bareSession.refreshNow(), bareCalls.length], [null, 0]);
    bareSession.stop();

    // ── the clients send the store's token ──
    const live = newAuth();
    live.setAuth({ accessToken: tokenFor(10, 7), refreshToken: 'rt-7' });
    const liveSession = createAuthSession({ auth: live, ...fake, refresh: async () => ({ accessToken: tokenFor(10, 8), refreshToken: 'rt-8' }) });
    const sent: string[] = [];
    (window as { fetch: unknown }).fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const authz = new Headers(init?.headers).get('Authorization') ?? '';
      sent.push(String(decodeJwtPayload(authz.replace('Bearer ', ''))?.n));
      return new Response('{}', { status: sent.length === 1 ? 401 : 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new ApiClient({ baseUrl: '/api', getToken: liveSession.getToken, onRefreshToken: liveSession.onRefreshToken });
    await api.get('/me');
    eq('ApiClient sends the token, and after a 401 the refreshed one', sent, ['7', '8']);
    window.fetch = realFetch;

    const urls: string[] = [];
    (window as { EventSource: unknown }).EventSource = class {
      onopen = null; onmessage = null; onerror = null; readyState = 0;
      constructor(url: string) { urls.push(url); }
      addEventListener(): void { /* not exercised */ }
      close(): void { /* nothing to close */ }
    };
    const sse = new SseClient({ url: '/sse', getToken: liveSession.getToken });
    sse.connect();
    sse.disconnect();
    const sseToken = new URL(urls[0] ?? '', location.href).searchParams.get('token') ?? '';
    eq('SseClient sends the store\'s current token', decodeJwtPayload(sseToken)?.n, 8);
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  } finally {
    window.fetch = realFetch;
    (window as { EventSource: unknown }).EventSource = realEventSource;
    for (const key of keys) localStorage.removeItem(key);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] auth-session-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] auth-session-smoke ${r}`);
})();
