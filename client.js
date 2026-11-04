window.__ModuleLoader__.load({
  id: 'dsh-current-branch-local',
  factory: (require) => {
    // Only `react` is guaranteed in the client module table. Everything else —
    // in particular the primitives icon set, whose export names change between
    // DSH releases (`IconBranchOutline16` → `IconBranchOutlineRegular`) — is
    // inlined here so a renamed export can never take the whole entry down.
    const React = require('react');
    const { useEffect, useRef, useState } = React;

    const SLOT = 'conversation.input.left';
    const ENTRY_ID = 'current-branch-local';
    const STATUS_PATH = '/api/current-branch-local';
    const REFRESH_MS = 5000;

    const LABEL_COLOR = 'var(--dsw-alias-label-secondary, #a8b0bd)';
    const MUTED_COLOR = 'var(--dsw-alias-label-tertiary, #8a8f98)';
    const ERROR_COLOR = 'var(--dsw-alias-state-error-primary, #e5484d)';

    /** Git branch glyph, same geometry as the DSH primitives icon. */
    function BranchGlyph({ size = 16 }) {
      return React.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          strokeWidth: 1,
          'aria-hidden': 'true',
          focusable: 'false',
          style: { flex: 'none' }
        },
        React.createElement('path', {
          d: 'M1.01503 8.0001L5.6964 8.0001C6.41913 8.0001 6.78049 8.0001 7.12115 7.91951C7.4232 7.84804 7.71233 7.73014 7.97821 7.57C8.27809 7.38939 8.5364 7.13669 9.05303 6.63129L11.3281 4.40564',
          stroke: 'currentColor'
        }),
        React.createElement('path', {
          d: 'M1.01221 7.9999L5.6964 7.9999C6.41913 7.9999 6.78049 7.9999 7.12115 8.08049C7.4232 8.15196 7.71233 8.26986 7.97821 8.43C8.27809 8.61061 8.5364 8.86331 9.05303 9.36871L11.3281 11.5944',
          stroke: 'currentColor'
        }),
        React.createElement('circle', { cx: '12.4502', cy: '3.3079', r: '1.56962', stroke: 'currentColor' }),
        React.createElement('circle', { cx: '12.4502', cy: '12.6921', r: '1.56962', stroke: 'currentColor' })
      );
    }

    /**
     * Poll the host status route for the session's workspace branch.
     * Every failure path resolves to a descriptive status instead of throwing,
     * so a broken route shows a hint rather than blanking the whole entry.
     */
    function useBranchStatus(sessionId) {
      const [status, setStatus] = useState({ kind: 'loading' });
      const seq = useRef(0);

      useEffect(() => {
        if (sessionId === undefined || sessionId === null) {
          setStatus({ kind: 'no-session' });
          return undefined;
        }
        const generation = seq.current + 1;
        seq.current = generation;
        let disposed = false;

        const refresh = async () => {
          let next;
          try {
            const response = await fetch(
              `${STATUS_PATH}?sessionId=${encodeURIComponent(sessionId)}`,
              { cache: 'no-store', headers: { accept: 'application/json' } }
            );
            let payload = null;
            try {
              payload = await response.json();
            } catch {
              payload = null;
            }
            if (!response.ok) {
              next = { kind: 'error', message: (payload && payload.error) || `HTTP ${response.status}` };
            } else if (!payload || typeof payload.kind !== 'string') {
              next = { kind: 'error', message: '响应格式不正确' };
            } else {
              next = payload;
            }
          } catch (error) {
            next = { kind: 'error', message: (error && error.message) || String(error) };
          }
          if (!disposed && seq.current === generation) setStatus(next);
        };

        setStatus({ kind: 'loading' });
        refresh();
        const timer = setInterval(refresh, REFRESH_MS);
        const refreshWhenVisible = () => {
          if (document.visibilityState === 'visible') refresh();
        };
        document.addEventListener('visibilitychange', refreshWhenVisible);
        window.addEventListener('focus', refreshWhenVisible);

        return () => {
          disposed = true;
          clearInterval(timer);
          document.removeEventListener('visibilitychange', refreshWhenVisible);
          window.removeEventListener('focus', refreshWhenVisible);
        };
      }, [sessionId]);

      return status;
    }

    /** Session-scoped branch chip rendered into the conversation input bar. */
    function BranchIndicator(props) {
      const status = useBranchStatus(props.sessionId);

      let label = '';
      let tone = LABEL_COLOR;
      let visible = true;
      if (status.kind === 'branch') {
        label = status.branch;
      } else if (status.kind === 'detached') {
        label = `HEAD ${status.branch}`;
      } else if (status.kind === 'loading') {
        label = '读取中…';
        tone = MUTED_COLOR;
      } else if (status.kind === 'not-repo') {
        label = '非 Git 仓库';
        tone = MUTED_COLOR;
      } else if (status.kind === 'no-workspace') {
        label = '无工作区';
        tone = MUTED_COLOR;
      } else if (status.kind === 'no-session') {
        visible = false;
      } else {
        label = '分支读取失败';
        tone = ERROR_COLOR;
      }
      if (!visible) return null;

      const cwd = typeof status.cwd === 'string' ? status.cwd : undefined;
      const detail = status.kind === 'error' ? `: ${status.message}` : cwd ? `\n${cwd}` : '';
      const title = `Git 分支：${label}${detail}`;

      return React.createElement(
        'span',
        {
          'data-current-branch-local': status.kind,
          title,
          'aria-label': title,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 0,
            maxWidth: 200,
            height: 28,
            color: tone,
            fontSize: 12,
            lineHeight: '16px',
            whiteSpace: 'nowrap'
          }
        },
        React.createElement(BranchGlyph, { size: 16 }),
        React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label)
      );
    }

    const inject = ['slots'];

    function apply(ctx) {
      ctx.slots.inject(SLOT, () =>
        ctx.slots.register(
          {
            name: SLOT,
            id: ENTRY_ID,
            order: 20
          },
          BranchIndicator
        )
      );
    }

    return { inject, apply };
  }
});
