import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const name = 'current-branch-local';
export const inject = ['connection', 'sessions'];
export const STATUS_PATH = '/api/current-branch-local';

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
  ctx.effect(() => ctx.connection.fetch.register({
    path: STATUS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const sessionId = new URL(request.url).searchParams.get('sessionId');
      if (!sessionId) {
        return Response.json({ error: 'Expected a session ID' }, { status: 400 });
      }
      const cwd = ctx.sessions.get(sessionId)?.header.cwd;
      if (!cwd) {
        return Response.json({ error: 'Session workspace is unavailable' }, { status: 404 });
      }
      try {
        return Response.json(await readBranch(cwd), { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        return Response.json({ error: error.stderr?.trim() || error.message }, { status: 500 });
      }
    }
  }), 'current-branch-local: read-only status');
}
