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

const tick = () => new Promise(resolve => setImmediate(resolve));

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
function loadClient({
  react,
  fetch,
  setInterval = () => 1,
  clearInterval = () => {},
  setTimeout = () => 1,
  clearTimeout = () => {},
  document,
  navigator = {},
  window
}) {
  let registration;
  const stubElement = () => ({
    style: {},
    value: '',
    setAttribute() {},
    select() {},
    remove() {}
  });
  runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      getSelection: () => null,
      ...window,
      __ModuleLoader__: { load: value => { registration = value; } }
    },
    document: document ?? {
      visibilityState: 'visible',
      addEventListener: () => {},
      removeEventListener: () => {},
      createElement: stubElement,
      body: { appendChild: () => {} },
      execCommand: () => true
    },
    navigator: { ...navigator },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
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

/**
 * Minimal React stand-in: positional hook slots, so two useState calls in one
 * component stay independent, plus a render() that restarts the hook cursor.
 */
function fakeReact() {
  const states = [];
  const refs = [];
  const effects = [];
  let cursor = 0;
  const tree = { hooks: { useState: 0, useEffect: 0, useRef: 0 } };
  return {
    tree,
    render(Component, props) {
      cursor = 0;
      return Component(props);
    },
    /** Run every mounted effect, returning the disposers it registered. */
    runEffects() {
      return effects.map(fn => fn());
    },
    React: {
      useState: initial => {
        const index = cursor++;
        tree.hooks.useState += 1;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [
          states[index],
          next => {
            states[index] = typeof next === 'function' ? next(states[index]) : next;
          }
        ];
      },
      useEffect: fn => {
        tree.hooks.useEffect += 1;
        effects.push(fn);
      },
      useRef: value => {
        const index = cursor++;
        tree.hooks.useRef += 1;
        if (!(index in refs)) refs[index] = { current: value };
        return refs[index];
      },
      createElement: (type, props, ...children) => {
        // Host refs: React attaches the mounted element; the tests need the same
        // handle to simulate selections anchored inside the chip.
        const node = { type, props: props ?? {}, children };
        node.contains = candidate => candidate === node || flatten(node).includes(candidate);
        if (node.props.ref && typeof node.props.ref === 'object') node.props.ref.current = node;
        return node;
      }
    }
  };
}

/** Mount the plugin's registered component with controllable host stubs. */
function mount({ fetch, timers = [], navigator, window, document } = {}) {
  const react = fakeReact();
  const { plugin, required } = loadClient({
    react: react.React,
    fetch,
    navigator,
    window,
    document,
    setTimeout: fn => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {}
  });
  const registrations = [];
  plugin.apply({
    slots: {
      inject: (slot, fn) => {
        assert.equal(slot, 'conversation.input.left');
        return fn();
      },
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      }
    }
  });
  return {
    react,
    plugin,
    required,
    registrations,
    render: props => react.render(registrations[0].component, props)
  };
}

function branchResponse(branch = 'feat/input-branch') {
  return { ok: true, status: 200, json: async () => ({ kind: 'branch', branch, cwd: '/repo' }) };
}

test('client registers one session-scoped indicator into the input bar', () => {
  const { plugin, required, registrations } = mount({ fetch: async () => branchResponse() });
  assert.deepEqual([...plugin.inject], ['slots']);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, 'conversation.input.left');
  assert.equal(registrations[0].options.id, 'current-branch-local');
  assert.ok(registrations[0].options.order > 0);
  assert.deepEqual(required, ['react'], 'client bundle must only require react');
});

test('indicator renders a branch label, an inline svg icon and no undefined element types', async () => {
  const app = mount({ fetch: async () => branchResponse() });
  const loading = app.render({ sessionId: 'session-1' });
  assert.equal(loading.props['data-current-branch-local'], 'loading');

  const [dispose] = app.react.runEffects();
  await tick();
  const rendered = app.render({ sessionId: 'session-1' });
  assert.equal(rendered.props['data-current-branch-local'], 'branch');
  assert.equal(rendered.children[1].children[0], 'feat/input-branch');
  assert.ok(rendered.props.title.startsWith('Git 分支：feat/input-branch'));
  assert.ok(rendered.props.title.includes('点击复制'));
  assert.equal(rendered.props.style.userSelect, 'text');
  assert.equal(rendered.children[1].props.style.userSelect, 'text');
  assert.match(rendered.props.style.cursor, /^url\("data:image\/png;base64,[^"]+"\) 3 3, pointer$/);

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

test('the copy cursor is an embedded 26x26 png, not the OS plus badge', async () => {
  const app = mount({ fetch: async () => branchResponse() });
  app.render({ sessionId: 'session-1' });
  const [dispose] = app.react.runEffects();
  await tick();
  const cursor = app.render({ sessionId: 'session-1' }).props.style.cursor;
  assert.notEqual(cursor, 'copy', 'cursor must not be the OS copy (plus) badge');

  const match = /^url\("data:image\/png;base64,([^"]+)"\) (\d+) (\d+), pointer$/.exec(cursor);
  assert.ok(match, `unexpected cursor: ${cursor}`);
  const bytes = Buffer.from(match[1], 'base64');
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'cursor payload is a png');
  assert.equal(bytes.readUInt32BE(16), 26, 'cursor width');
  assert.equal(bytes.readUInt32BE(20), 26, 'cursor height');
  assert.ok(Number(match[2]) < 26 && Number(match[3]) < 26, 'hotspot inside the image');
  dispose();
});

test('mousedown stays inside the chip so the composer cannot cancel the selection', async () => {
  const app = mount({ fetch: async () => branchResponse() });
  app.render({ sessionId: 'session-1' });
  const [dispose] = app.react.runEffects();
  await tick();
  const rendered = app.render({ sessionId: 'session-1' });
  const calls = [];
  rendered.props.onMouseDown({ stopPropagation: () => calls.push('mousedown') });
  rendered.props.onClick({ stopPropagation: () => calls.push('click') });
  assert.deepEqual(calls, ['mousedown', 'click']);
  dispose();
});

test('clicking the chip copies the branch name and flashes a confirmation', async () => {
  const timers = [];
  const written = [];
  const app = mount({
    fetch: async () => branchResponse('feat/copy-me'),
    timers,
    navigator: {
      clipboard: {
        writeText: async text => {
          written.push(text);
        }
      }
    }
  });
  app.render({ sessionId: 'session-1' });
  const [dispose] = app.react.runEffects();
  await tick();

  const rendered = app.render({ sessionId: 'session-1' });
  rendered.props.onClick({ stopPropagation: () => {} });
  await tick();
  assert.deepEqual(written, ['feat/copy-me']);

  const copied = app.render({ sessionId: 'session-1' });
  assert.equal(copied.children[1].children[0], '已复制');
  assert.ok(copied.props.title.startsWith('Git 分支：feat/copy-me'));

  timers[timers.length - 1]();
  assert.equal(app.render({ sessionId: 'session-1' }).children[1].children[0], 'feat/copy-me');
  dispose();
});

test('clicking a chip whose text is being selected does not clobber the clipboard', async () => {
  const written = [];
  let selected = null;
  const app = mount({
    fetch: async () => branchResponse('feat/select-me'),
    navigator: {
      clipboard: {
        writeText: async text => {
          written.push(text);
        }
      }
    },
    window: { getSelection: () => selected }
  });
  app.render({ sessionId: 'session-1' });
  const [dispose] = app.react.runEffects();
  await tick();

  const rendered = app.render({ sessionId: 'session-1' });
  const label = rendered.children[1];
  selected = { rangeCount: 1, isCollapsed: false, anchorNode: label, focusNode: label };
  rendered.props.onClick({ stopPropagation: () => {} });
  await tick();
  assert.deepEqual(written, [], 'a real text selection wins over click-to-copy');

  selected = { rangeCount: 1, isCollapsed: true, anchorNode: null, focusNode: null };
  rendered.props.onClick({ stopPropagation: () => {} });
  await tick();
  assert.deepEqual(written, ['feat/select-me']);
  dispose();
});

test('clipboard falls back to a hidden textarea when the async API is unavailable', async () => {
  const timers = [];
  const areas = [];
  const document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => {
      const area = {
        style: {},
        value: '',
        selected: false,
        setAttribute() {},
        select() {
          this.selected = true;
        },
        remove() {}
      };
      areas.push(area);
      return area;
    },
    body: { appendChild: () => {} },
    execCommand: () => true
  };
  const app = mount({
    fetch: async () => branchResponse('feat/legacy'),
    timers,
    document,
    navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } }
  });
  app.render({ sessionId: 'session-1' });
  const [dispose] = app.react.runEffects();
  await tick();

  app.render({ sessionId: 'session-1' }).props.onClick({ stopPropagation: () => {} });
  await tick();
  assert.equal(areas.length, 1);
  assert.equal(areas[0].value, 'feat/legacy');
  assert.equal(areas[0].selected, true);
  assert.equal(app.render({ sessionId: 'session-1' }).children[1].children[0], '已复制');
  dispose();
});

test('reports a failed copy instead of pretending it worked', async () => {
  const document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ style: {}, value: '', setAttribute() {}, select() {}, remove() {} }),
    body: { appendChild: () => {} },
    execCommand: () => false
  };
  const app = mount({ fetch: async () => branchResponse('feat/legacy'), document });
  app.render({ sessionId: 'session-1' });
  const [dispose] = app.react.runEffects();
  await tick();

  app.render({ sessionId: 'session-1' }).props.onClick({ stopPropagation: () => {} });
  await tick();
  assert.equal(app.render({ sessionId: 'session-1' }).children[1].children[0], '复制失败');
  dispose();
});

test('detached HEAD copies the commit hash while showing the HEAD label', async () => {
  const written = [];
  const timers = [];
  const app = mount({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ kind: 'detached', branch: 'abc1234' }) }),
    timers,
    navigator: {
      clipboard: {
        writeText: async text => {
          written.push(text);
        }
      }
    }
  });
  app.render({ sessionId: 'session-1' });
  const [dispose] = app.react.runEffects();
  await tick();

  const rendered = app.render({ sessionId: 'session-1' });
  assert.equal(rendered.children[1].children[0], 'HEAD abc1234');
  rendered.props.onClick({ stopPropagation: () => {} });
  await tick();
  assert.deepEqual(written, ['abc1234']);
  dispose();
});

test('indicator degrades to visible status text instead of blanking out', async () => {
  const cases = [
    [{ ok: false, status: 404, json: async () => ({ error: '会话工作区不可用' }) }, '分支读取失败', 'error'],
    [{ ok: true, status: 200, json: async () => ({ kind: 'not-repo', cwd: '/tmp' }) }, '非 Git 仓库', 'not-repo'],
    [{ ok: true, status: 200, json: async () => ({ kind: 'no-workspace' }) }, '无工作区', 'no-workspace']
  ];
  for (const [response, label, kind] of cases) {
    const written = [];
    const app = mount({
      fetch: async () => response,
      navigator: {
        clipboard: {
          writeText: async text => {
            written.push(text);
          }
        }
      }
    });
    app.render({ sessionId: 'session-1' });
    const [dispose] = app.react.runEffects();
    await tick();
    const rendered = app.render({ sessionId: 'session-1' });
    assert.equal(rendered.props['data-current-branch-local'], kind);
    assert.equal(rendered.children[1].children[0], label);
    assert.equal(rendered.props.style.cursor, 'default', `${kind} keeps the default pointer`);
    if (kind === 'error') assert.ok(rendered.props.title.includes('会话工作区不可用'));

    // Non-branch states have nothing to copy.
    rendered.props.onClick({ stopPropagation: () => {} });
    await tick();
    assert.deepEqual(written, [], `${kind} must not copy anything`);
    dispose();
  }
});

test('indicator renders nothing without a session and refetches when the session changes', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(url);
    const sessionId = new URL(url, 'http://localhost').searchParams.get('sessionId');
    return { ok: true, status: 200, json: async () => ({ kind: 'branch', branch: `branch-of-${sessionId}` }) };
  };

  const idle = mount({ fetch });
  assert.equal(idle.render({}).props['data-current-branch-local'], 'loading');
  const [disposeIdle] = idle.react.runEffects();
  await tick();
  assert.equal(idle.render({}), null);
  disposeIdle?.();

  const active = mount({ fetch });
  active.render({ sessionId: 'a' });
  const [dispose] = active.react.runEffects();
  await tick();
  assert.equal(active.render({ sessionId: 'a' }).children[1].children[0], 'branch-of-a');
  assert.ok(urls.some(url => url.endsWith('sessionId=a')));
  dispose();
});

function flatten(node) {
  if (node === null || typeof node !== 'object') return [];
  const nodes = [node];
  for (const child of node.children ?? []) nodes.push(...flatten(child));
  return nodes;
}

function findElement(node, predicate) {
  return flatten(node).find(node => predicate(node));
}
