# DSH Current Branch

在 DeepSeek Harness Desktop 的对话输入栏显示当前会话工作区的 Git 分支。

- 按会话工作区读取分支，每 5 秒刷新一次。
- 支持普通分支、尚无提交的新仓库和分离 HEAD 状态。
- 非 Git 仓库和读取错误会显示状态；错误详情可通过悬停查看。
- 只读，不提供切换分支、提交、拉取或推送操作。

## 安装

需要安装 Git，并使用支持客户端插件的 DeepSeek Harness Desktop。通过 `dsh` 命令安装到桌面配置：

```sh
dsh plugin --profile desktop add github:ZHI00/dsh-current-branch
```

安装后完全退出并重新打开 DeepSeek Harness。打开 Git 仓库对应的会话，分支状态位于输入栏左侧。

卸载：

```sh
dsh plugin --profile desktop remove dsh-current-branch-local
```

## 兼容性与验证

针对 DeepSeek Harness Desktop `0.2.1-rc.5` 的插件接口开发。自动测试覆盖 Git 状态读取、会话状态接口、槽位注册和组件渲染；另用真实 React 18 渲染验证了组件不会因为图标/元素类型缺失而崩溃。使用其他版本时可能需要调整插件接口。

客户端 bundle 只依赖模块表中的 `react`：分支图标内联为 SVG，不再引用 `@deepseek-ai/dsh-client-ui-primitives` 的图标（这些导出名在 DSH 各版本间会变化，旧版 `IconBranchOutline16` 在 `0.2.1-rc.5` 已不存在，会导致整个条目渲染崩溃并被槽位错误边界静默移除）。

## 变更记录

- `1.0.2` — 修复输入栏不显示分支：图标改为内联 SVG，去掉对 primitives 图标导出的依赖；读取失败/非仓库/无工作区不再静默消失，而是显示状态（悬停可看详情）；补充窗口重新可见时刷新；状态接口返回工作区路径用于提示。
- `1.0.1` — 首个本地版。

## 开发与测试

需要 Node.js 和 Git，不需要安装额外依赖：

```sh
node --test test.js
```

## 许可证

[MIT](LICENSE)
