import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const name = 'current-branch-local';
export const inject = ['connection', 'sessions'];
export const STATUS_PATH = '/api/current-branch-local';

const TIMEOUT_MS = 5000;

function git(cwd, ...args) {
  return exec('git', ['-C', cwd, ...args], {
    timeout: TIMEOUT_MS,
    maxBuffer: 65536,
    windowsHide: true,
    env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
  });
}

/**
 * Read the branch of the repository containing `cwd`.
 * Reported kinds: branch | detached | not-repo. Unexpected failures throw so the
 * route can surface the git message instead of a silently empty chip.
 */
export async function readBranch(cwd) {
  let revParse;
  try {
    revParse = await git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('未找到 git 可执行文件，请先安装 Git');
    const stderr = String(error.stderr ?? '');
    if (/cannot change to|No such file or directory/i.test(stderr)) {
      throw new Error(`会话工作区不存在：${cwd}`);
    }
    if (/not a git repository/i.test(stderr)) return { kind: 'not-repo' };
    // An initialized repository without commits still has a symbolic branch.
    if (/unknown revision|ambiguous argument|bad revision/i.test(stderr)) {
      const { stdout } = await git(cwd, 'symbolic-ref', '--short', 'HEAD');
      return { kind: 'branch', branch: stdout.trim() };
    }
    throw error;
  }

  const branch = revParse.stdout.trim();
  if (branch !== 'HEAD') return { kind: 'branch', branch };

  const { stdout: hash } = await git(cwd, 'rev-parse', '--short', 'HEAD');
  return { kind: 'detached', branch: hash.trim() };
}

/** Resolve the workspace directory a live session reports, if any. */
export function sessionCwd(sessions, sessionId) {
  try {
    return sessions.get(sessionId)?.header?.cwd;
  } catch {
    return undefined;
  }
}

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: STATUS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        async fetch(request) {
          const sessionId = new URL(request.url).searchParams.get('sessionId');
          if (!sessionId) {
            return Response.json({ error: '缺少 sessionId 参数' }, { status: 400 });
          }
          const cwd = sessionCwd(ctx.sessions, sessionId);
          if (!cwd) {
            return Response.json({ error: '会话工作区不可用' }, { status: 404 });
          }
          try {
            const status = await readBranch(cwd);
            return Response.json({ ...status, cwd }, { headers: { 'cache-control': 'no-store' } });
          } catch (error) {
            const message = String(error.stderr ?? '').trim() || error.message;
            return Response.json(
              { error: message, cwd },
              { status: 500, headers: { 'cache-control': 'no-store' } }
            );
          }
        }
      }),
    'current-branch-local: read-only status'
  );
}
