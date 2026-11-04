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
    const FEEDBACK_MS = 1400;

    const LABEL_COLOR = 'var(--dsw-alias-label-secondary, #a8b0bd)';
    const MUTED_COLOR = 'var(--dsw-alias-label-tertiary, #8a8f98)';
    const ERROR_COLOR = 'var(--dsw-alias-state-error-primary, #e5484d)';
    const COPIED_COLOR = 'var(--dsw-alias-state-business-primary, #4c8dff)';

    /**
     * Pointer shown over the chip. `cursor: copy` is the OS drag-copy cursor,
     * which macOS paints as a plus badge, so the chip carries its own glyph:
     * a 26x26 PNG of two stacked blue cards (brand blue gradient, transparent
     * gap, soft shadow — readable on both themes), hotspot at (3,3).
     */
    const COPY_CURSOR =
      'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAaCAYAAACpSkzOAAAEBUlEQVR4nJ2WTWhcVRTH/+fe9yaTkDQmMW3TEiMtImlEKbgSwWh3uhHrLAVrW6WKi64Kgkziwl0XIgjWtNqKm0wWonWhpTCpoBSzqZIu1GoVU2OgIckkmXnv3nOP3DczSSafMzlw58Gbe+/vfL9DqEdEKJODOtINQh7A4CZ7Ku/z+TzGhwYZRIJGJJsV1dCBLc4RthMR8pplzv/Q3Nkx8Cw7s9c5g83IDoBSIZTWc3Zm+vqlc/0FDxseJrctqLrptY/+eFSFe8Z0ED4Gqt1OyY8CrXkvELCJ78bLSycuv92br96zOUgkcfCpkfkOY4q/tT24v7O0MA+iWltEHNhGELaxSMLz5ySVbg1NtDwvZAaunOm9l80OUbAZ5PULCAbvQfq6iz1OXH7mzi/eLxrV8BKgSAlUkA7CdH+qeU+fYwNrSk6RVqWlQpxu7WovFv57CaAPAdE1oMRMIncBMJVXkwCOYxtp73vigedOXnw53b7/vSBs6bHRkkApZZnFxHwg2TQIrIJEyEMy5/9u7jrQOwjhvTYyXndNSq9LVYYONZyTOTs1d+3Sue6Rp09dvnFw4Nh3WqcfYhM5Zgosc5IIXoK1lpy4WDoSpIIxEPpBGmGz3jxdRCcPpQDd0/HXq58UTn92uu3a8+9OvNXW9fBV6wDNAuZKDuQ9SISGALndLa2Wo68CpQ8vL0Rmx9T3IoKwJd0nlMq98vHs45+/0fnNi+//ORE0tTzJliFutZaVr3giklQYPRM0NR1emi9adgjZIdhxCQXFQtHoplQ7G53EUkDfO0rBX2ItViSYmSxrziz72Cvho8ENdA8BWQuJjUkCz6wXict/uZUIrUkGjoU5BLGHNNKlSGCdh5WvZQdFFUVdovV6kBBZBvxqVJT1llQ8I5By00m8JBtAxu/0B2xjTRe+5VivYPl2Zx3YV4OIWEd6o0UG4DDRomGQZaxkWOJAy0JKE8fxwkYQl9duXEf+XCXDDDtON7dSqfBvcXZq4ktfJeOAWwF5TTxkNxapBFRxnZM2E8dx4f7vZ27nTt4WESKiGpDYaoyoEY4kyWAZiS9sjNHpnz8du/Pt2R+RFV+jrjYZLOsggHir1n12duKAqvUH4OYHh276ZyYzqnPD1YqqiZGbg0+8pBBUXaVE5W+SKH8uigoJICup3BBMjlYhXtT4kDdZqHR/9nq0NDdNQVtgLRtrxVrrtlnin0ZUc1haXIgWp24lgc8BdrPBpOwkP0gMkzv65t1jurV7VKdaOuvtDs4sLy5P3zo7eeWpkeqMsZX1ZalsOvTCF4+0HDx6HKL3wUXkZ4INIg5QTSISL8z/+vXVf26881NV2frU2+VohczoSgfYSjbmV2VYrJeRy8DVMyz+DyG7aqtk5CuzAAAAAElFTkSuQmCC") 3 3, pointer';

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

    /** Copy text through the async clipboard API, with a legacy fallback. */
    async function writeClipboard(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(text);
          return;
        } catch {
          // Unfocused document / denied permission: fall back to the textarea.
        }
      }
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) throw new Error('复制失败');
    }

    /** True when the live text selection sits inside `element`. */
    function hasSelectionInside(element) {
      const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
      if (!element || !selection.anchorNode || !selection.focusNode) return false;
      return element.contains(selection.anchorNode) && element.contains(selection.focusNode);
    }

    /** Session-scoped branch chip rendered into the conversation input bar. */
    function BranchIndicator(props) {
      const status = useBranchStatus(props.sessionId);
      const [feedback, setFeedback] = useState(null);
      const feedbackTimer = useRef(null);
      const chip = useRef(null);

      useEffect(
        () => () => {
          if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
        },
        []
      );

      const flash = kind => {
        setFeedback(kind);
        if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
        feedbackTimer.current = setTimeout(() => {
          feedbackTimer.current = null;
          setFeedback(null);
        }, FEEDBACK_MS);
      };

      let label = '';
      let tone = LABEL_COLOR;
      let visible = true;
      let copyable = false;
      if (status.kind === 'branch') {
        label = status.branch;
        copyable = true;
      } else if (status.kind === 'detached') {
        label = `HEAD ${status.branch}`;
        copyable = true;
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

      const branchLabel = label;
      if (feedback === 'copied') {
        label = '已复制';
        tone = COPIED_COLOR;
      } else if (feedback === 'failed') {
        label = '复制失败';
        tone = ERROR_COLOR;
      }

      const cwd = typeof status.cwd === 'string' ? status.cwd : undefined;
      const detail = status.kind === 'error' ? `: ${status.message}` : cwd ? `\n${cwd}` : '';
      const hint = copyable ? '（点击复制，可选中文本）' : '';
      const title = `Git 分支：${branchLabel}${detail}${hint}`;

      return React.createElement(
        'span',
        {
          ref: chip,
          'data-current-branch-local': status.kind,
          title,
          'aria-label': title,
          // The composer card preventDefaults mousedown to refocus the draft
          // editor, which would cancel any selection starting in this chip.
          onMouseDown: event => event.stopPropagation(),
          onClick: event => {
            event.stopPropagation();
            if (!copyable || hasSelectionInside(chip.current)) return;
            writeClipboard(status.branch).then(
              () => flash('copied'),
              () => flash('failed')
            );
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minWidth: 0,
            maxWidth: 220,
            height: 28,
            color: tone,
            fontSize: 12,
            lineHeight: '16px',
            whiteSpace: 'nowrap',
            userSelect: 'text',
            cursor: copyable ? COPY_CURSOR : 'default'
          }
        },
        React.createElement(BranchGlyph, { size: 16 }),
        React.createElement(
          'span',
          {
            style: {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              userSelect: 'text'
            }
          },
          label
        )
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
