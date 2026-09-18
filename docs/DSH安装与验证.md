# DSH 安装与验证

## 安装

从插件市场安装 **Oil DSH Title**。命令行直装 GitHub Release：

```sh
dsh plugin --profile web add https://github.com/598829314/oil-dsh-title/releases/latest/download/oil-dsh-title.tgz
```

已有 profile 若因远程 tarball 的锁文件策略失败，可直接固定 GitHub 源：

```sh
dsh plugin --profile desktop add github:598829314/oil-dsh-title
```

安装后按宿主提示刷新页面或重启。插件的 bundle patch 会插入 `oil-dsh-title` Cordis 行。

## 验证路径

按四层检查，不把其中一层当成全部证据：

1. **结构检查**：`npm test` 验证 `emoji + 对象｜目标`、长度、隐私过滤和流式块组装。
2. **包检查**：`npm run check` 确认 `package.json` 的 `dsh.bundle`、patch 文件和 npm 包内容完整。
3. **真实触发**：在新会话发送一个明确任务，等待当前轮结束；插件监听 `user/message` 与 `request/header`，随后调用当前会话路由生成标题。
4. **界面检查**：确认侧边栏标题出现一个类别 emoji 和一个全角 `｜`，且没有新增命名消息。

## 安全边界

插件不改写 DSH 核心安装文件，不直接写会话数据库，不抢占默认 `sessionTitle` provider 注册槽。它只使用 `sessionTitle.rename()` 写入宿主认可的标题事件。

标题模型失败时保持原标题。卸载插件后，未来会话恢复 DSH 默认标题行为；已有标题事件不会被插件删除。

## 已知限制

插件只在会话产生新的用户消息时评估，不会自动扫描并批量重命名历史会话。旧会话打开后发送一条具体任务即可触发一次评估。
