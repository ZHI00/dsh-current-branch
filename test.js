import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { apply, CHANNEL, readBranch } from './index.js';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('reads regular, unborn, detached and non-repository states', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-branch-test-'));
  assert.deepEqual(await readBranch(root), { kind: 'not-repo' });
  git(root, 'init', '-b', 'feature-test');
  assert.deepEqual(await readBranch(root), { kind: 'branch', branch: 'feature-test' });
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'test');
  assert.deepEqual(await readBranch(root), { kind: 'branch', branch: 'feature-test' });
  git(root, 'checkout', '--detach');
  assert.deepEqual(await readBranch(root), { kind: 'detached', branch: git(root, 'rev-parse', '--short', 'HEAD') });
});

test('RPC uses the selected session directory and rejects missing sessions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-branch-rpc-'));
  git(root, 'init', '-b', 'rpc-test');
  let handler;
  apply({
    sessions: { get: id => id === 'selected' ? { header: { cwd: root } } : undefined },
    connection: { rpc: { handle: (channel, fn) => { assert.equal(channel, CHANNEL); handler = fn; return () => {}; } } },
    effect: fn => fn()
  });
  assert.deepEqual(await handler('status', { sessionId: 'selected' }), {
    ok: true, value: { cwd: root, kind: 'branch', branch: 'rpc-test' }
  });
  assert.equal((await handler('status', { sessionId: 'missing' })).error.code, 'no-workspace');
  assert.equal((await handler('other', { sessionId: 'selected' })).error.code, 'bad-request');
});

test('client registers a session-scoped indicator and renders status', async () => {
  let registration;
  let options;
  let Component;
  let state = { kind: 'loading' };
  let effect;
  let timer;
  const react = {
    useState: () => [state, next => { state = next; }],
    useEffect: fn => { effect = fn; },
    createElement: (type, props, ...children) => ({ type, props, children })
  };
  runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { registration = value; } } },
    setInterval: fn => { timer = fn; return 1; },
    clearInterval: () => {}
  });
  const plugin = registration.factory(id => id === 'react' ? react : { IconBranchOutline16: 'branch-icon' });
  const ctx = {
    get: () => ({ rpc: { call: async (_channel, _endpoint, payload) => ({ ok: true, value: { kind: 'branch', branch: payload.sessionId } }) } }),
    slots: {
      inject: (slot, fn) => { assert.equal(slot, 'conversation.input.left'); return fn(); },
      register: (config, component) => { options = config; Component = component; return () => {}; }
    }
  };
  plugin.apply(ctx);
  const props = { sessionId: 'sample-branch', useSessions: fn => fn({ byId: { 'sample-branch': { cwd: '/repo' } } }), ...options.inject('sample-branch') };
  assert.equal(Component(props).props['data-current-branch-local'], 'loading');
  const dispose = effect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(Component(props).children[1].children[0], 'sample-branch');
  assert.equal(typeof timer, 'function');
  dispose();
});
