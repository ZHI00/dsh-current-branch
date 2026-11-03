import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const name = 'current-branch-local';
export const inject = ['connection', 'sessions'];
export const CHANNEL = '/current-branch-local';

export async function readBranch(cwd) {
  const git = (...args) => exec('git', ['-C', cwd, ...args], {
    timeout: 5000,
    maxBuffer: 65536,
    env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }
  });
  try {
    const { stdout } = await git('rev-parse', '--abbrev-ref', 'HEAD');
    const branch = stdout.trim();
    if (branch !== 'HEAD') return { kind: 'branch', branch };
    const { stdout: hash } = await git('rev-parse', '--short', 'HEAD');
    return { kind: 'detached', branch: hash.trim() };
  } catch (error) {
    if (/not a git repository/.test(error.stderr ?? '')) return { kind: 'not-repo' };
    // An initialized repository without commits still has a symbolic branch.
    if (/unknown revision|ambiguous argument/.test(error.stderr ?? '')) {
      const { stdout } = await git('symbolic-ref', '--short', 'HEAD');
      return { kind: 'branch', branch: stdout.trim() };
    }
    throw error;
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    if (endpoint !== 'status' || typeof payload?.sessionId !== 'string') {
      return { ok: false, error: { code: 'bad-request', message: 'Expected a session ID', details: {} } };
    }
    const cwd = ctx.sessions.get(payload.sessionId)?.header.cwd;
    if (!cwd) {
      return { ok: false, error: { code: 'no-workspace', message: 'Session workspace is unavailable', details: {} } };
    }
    try {
      return { ok: true, value: { cwd, ...await readBranch(cwd) } };
    } catch (error) {
      return { ok: false, error: { code: 'git-error', message: error.stderr?.trim() || error.message, details: {} } };
    }
  }), 'current-branch-local: read-only status');
}
