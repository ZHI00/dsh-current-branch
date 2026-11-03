window.__ModuleLoader__.load({
  id: 'dsh-current-branch-local',
  factory: (require) => {
    const React = require('react');
    const { IconBranchOutline16 } = require('@deepseek-ai/dsh-client-ui-primitives');

    function BranchIndicator({ sessionId, useSessions, loadBranch }) {
      const cwd = useSessions(state => state.byId[sessionId]?.cwd);
      const [status, setStatus] = React.useState({ kind: 'loading' });

      React.useEffect(() => {
        if (!cwd) {
          setStatus({ kind: 'no-workspace' });
          return;
        }
        let active = true;
        const refresh = () => {
          loadBranch().then(result => {
            if (active) setStatus(result);
          }, error => {
            if (active) setStatus({ kind: 'error', message: error.message });
          });
        };
        setStatus({ kind: 'loading' });
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => {
          active = false;
          clearInterval(timer);
        };
      }, [cwd, loadBranch]);

      const label = status.kind === 'branch' ? status.branch
        : status.kind === 'detached' ? `HEAD ${status.branch}`
        : status.kind === 'not-repo' ? '非 Git 仓库'
        : status.kind === 'loading' ? '正在读取'
        : status.kind === 'no-workspace' ? '无工作区'
        : '读取失败';
      const title = status.kind === 'error' ? `Git 分支读取失败: ${status.message}` : `Git 分支: ${label}`;
      return React.createElement('span', {
        'data-current-branch-local': status.kind,
        title,
        'aria-label': title,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0,
          maxWidth: 180, height: 28, color: 'var(--dsw-alias-label-secondary)',
          fontSize: 12, whiteSpace: 'nowrap'
        }
      }, React.createElement(IconBranchOutline16, { size: 16 }),
      React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label));
    }

    const inject = ['slots'];
    function apply(ctx) {
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'current-branch-local',
        order: 20,
        inject: sessionId => ({
          loadBranch: async () => {
            const response = await fetch(`/api/current-branch-local?sessionId=${encodeURIComponent(sessionId)}`, {
              cache: 'no-store'
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            return result;
          }
        })
      }, BranchIndicator));
    }
    return { inject, apply };
  }
});
