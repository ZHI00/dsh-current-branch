import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { apply, STATUS_PATH, readBranch, sessionCwd } from './index.js';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('reads regular, unborn, detached states', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-branch-test-'));
  assert.deepEqual(await readBranch(root), { kind: 'not-repo' });
  git(root, 'init', '-b', 'feature-test');
  assert.deepEqual(await readBranch(root), { kind: 'branch', branch: 'feature-test' });
  git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'test');
  assert.deepEqual(await readBranch(root), { kind: 'branch', branch: 'feature-test' });
  git(root, 'checkout', '--detach');
  assert.deepEqual(await readBranch(root), { kind: 'detached', branch: git(root, 'rev-parse', '--short', 'HEAD') });
});

test('status route uses the selected session directory and rejects missing sessions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-branch-rpc-'));
  git(root, 'init', '-b', 'rpc-test');
  let route;
  apply({
    sessions: { get: id => (id === 'selected' ? { header: { cwd: root } } : undefined) },
    connection: { fetch: { register: value => { route = value; return () => {}; } } },
    effect: fn => fn()
  });
  assert.equal(route.path, STATUS_PATH);
  assert.deepEqual(route.methods, ['GET']);
  const response = await route.fetch(new Request(`http://localhost${STATUS_PATH}?sessionId=selected`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { kind: 'branch', branch: 'rpc-test', cwd: root });
  assert.equal((await route.fetch(new Request(`http://localhost${STATUS_PATH}?sessionId=missing`))).status, 404);
  assert.equal((await route.fetch(new Request(`http://localhost${STATUS_PATH}`))).status, 400);
});

test('session lookup tolerates a throwing session registry', () => {
  assert.equal(sessionCwd({ get: () => { throw new Error('boom'); } }, 'x'), undefined);
  assert.equal(sessionCwd({ get: () => ({ header: { cwd: '/repo' } }) }, 'x'), '/repo');
  assert.equal(sessionCwd({ get: () => undefined }, 'x'), undefined);
});

/**
 * Load client.js the way the DSH module loader does, with a require() that only
 * serves 'react'. Requiring anything else fails, which pins the invariant behind
 * the blank-indicator bug: the bundle must not depend on version-specific
 * primitives exports.
 */
function loadClient({ react, fetch, setInterval = () => 1, clearInterval = () => {}, document, window }) {
  let registration;
  runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      ...window,
      __ModuleLoader__: { load: value => { registration = value; } }
    },
    document: document ?? { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} },
    setInterval,
    clearInterval,
    fetch,
    encodeURIComponent,
    String,
    Error,
    console
  });
  const required = [];
  const plugin = registration.factory(specifier => {
    required.push(specifier);
    if (specifier === 'react') return react;
    throw new Error(`client bundle required unexpected module "${specifier}"`);
  });
  return { plugin, required };
}

/** Minimal React stand-in: enough to drive the component and inspect its tree. */
function fakeReact(initialState) {
  let state = initialState;
  let effect;
  const tree = { hooks: { useState: 0, useEffect: 0, useRef: 0 } };
  return {
    tree,
    get state() { return state; },
    runEffect() { return effect(); },
    React: {
      useState: () => {
        tree.hooks.useState += 1;
        return [state, next => { state = typeof next === 'function' ? next(state) : next; }];
      },
      useEffect: fn => {
        tree.hooks.useEffect += 1;
        effect = fn;
      },
      useRef: value => {
        tree.hooks.useRef += 1;
        return { current: value };
      },
      createElement: (type, props, ...children) => ({ type, props, children })
    }
  };
}

function findElement(node, predicate) {
  if (node === null || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const hit = findElement(child, predicate);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

test('client registers one session-scoped indicator into the input bar', () => {
  const react = fakeReact({ kind: 'loading' });
  const { plugin, required } = loadClient({ react: react.React, fetch: async () => ({}) });
  const registered = [];
  const slots = {
    inject: (slot, fn) => {
      assert.equal(slot, 'conversation.input.left');
      return fn();
    },
    register: (options, component) => {
      registered.push({ options, component });
      return () => {};
    }
  };
  plugin.apply({ slots });
  assert.deepEqual([...plugin.inject], ['slots']);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].options.name, 'conversation.input.left');
  assert.equal(registered[0].options.id, 'current-branch-local');
  assert.ok(registered[0].options.order > 0);
  assert.deepEqual(required, ['react'], 'client bundle must only require react');
});

test('indicator renders a branch label, an inline svg icon and no undefined element types', async () => {
  const react = fakeReact({ kind: 'loading' });
  let requested;
  const { plugin } = loadClient({
    react: react.React,
    fetch: async url => {
      requested = url;
      return { ok: true, status: 200, json: async () => ({ kind: 'branch', branch: 'feat/input-branch', cwd: '/repo' }) };
    }
  });
  let component;
  plugin.apply({
    slots: {
      inject: (slot, fn) => fn(),
      register: (options, value) => { component = value; return () => {}; }
    }
  });

  const tree = component({ sessionId: 'session-1' });
  assert.equal(tree.props['data-current-branch-local'], 'loading');

  const dispose = react.runEffect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requested, `${STATUS_PATH}?sessionId=session-1`);
  const rendered = component({ sessionId: 'session-1' });
  assert.equal(rendered.props['data-current-branch-local'], 'branch');
  assert.equal(rendered.children[1].children[0], 'feat/input-branch');
  assert.ok(rendered.props.title.startsWith('Git 分支：feat/input-branch'));

  const icon = findElement(rendered, node => typeof node.type === 'function');
  assert.ok(icon, 'indicator renders a component icon element');
  const svg = icon.type({ size: 16 });
  assert.equal(svg.type, 'svg');
  assert.equal(svg.props.width, 16);
  assert.ok(svg.children.some(child => child.type === 'path'), 'icon carries vector geometry');
  for (const node of flatten(rendered)) {
    assert.notEqual(node.type, undefined, 'no element may be created with an undefined type');
    assert.notEqual(node.type, null, 'no element may be created with a null type');
  }
  dispose();
});

test('indicator degrades to visible status text instead of blanking out', async () => {
  const cases = [
    [{ ok: false, status: 404, json: async () => ({ error: '会话工作区不可用' }) }, '分支读取失败', 'error'],
    [{ ok: true, status: 200, json: async () => ({ kind: 'not-repo', cwd: '/tmp' }) }, '非 Git 仓库', 'not-repo'],
    [{ ok: true, status: 200, json: async () => ({ kind: 'no-workspace' }) }, '无工作区', 'no-workspace'],
    [{ ok: true, status: 200, json: async () => ({ kind: 'detached', branch: 'abc1234' }) }, 'HEAD abc1234', 'detached']
  ];
  for (const [response, label, kind] of cases) {
    const react = fakeReact({ kind: 'loading' });
    const { plugin } = loadClient({ react: react.React, fetch: async () => response });
    let component;
    plugin.apply({
      slots: {
        inject: (slot, fn) => fn(),
        register: (options, value) => { component = value; return () => {}; }
      }
    });
    component({ sessionId: 'session-1' });
    react.runEffect();
    await new Promise(resolve => setImmediate(resolve));
    const tree = component({ sessionId: 'session-1' });
    assert.equal(tree.props['data-current-branch-local'], kind);
    assert.equal(tree.children[1].children[0], label);
    if (kind === 'error') assert.ok(tree.props.title.includes('会话工作区不可用'));
  }
});

test('indicator renders nothing without a session and refetches when the session changes', async () => {
  const urls = [];
  const make = () => {
    const react = fakeReact({ kind: 'loading' });
    const { plugin } = loadClient({
      react: react.React,
      fetch: async url => {
        urls.push(url);
        const sessionId = new URL(url, 'http://localhost').searchParams.get('sessionId');
        return { ok: true, status: 200, json: async () => ({ kind: 'branch', branch: `branch-of-${sessionId}` }) };
      }
    });
    let component;
    plugin.apply({
      slots: {
        inject: (slot, fn) => fn(),
        register: (options, value) => { component = value; return () => {}; }
      }
    });
    return { react, component };
  };

  const withoutSession = make();
  assert.equal(withoutSession.component({}).props['data-current-branch-local'], 'loading');
  const disposeIdle = withoutSession.react.runEffect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(withoutSession.component({}), null);
  disposeIdle?.();

  const withSession = make();
  withSession.component({ sessionId: 'a' });
  const dispose = withSession.react.runEffect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(withSession.component({ sessionId: 'a' }).children[1].children[0], 'branch-of-a');
  assert.ok(urls.some(url => url.endsWith('sessionId=a')));
  dispose();
});

function flatten(node) {
  if (node === null || typeof node !== 'object') return [];
  const nodes = [node];
  for (const child of node.children ?? []) nodes.push(...flatten(child));
  return nodes;
}
