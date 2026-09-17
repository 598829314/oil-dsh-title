# oil-dsh-title

一个 DeepSeek Harness 会话标题插件。它把 [oil-codex-title](https://github.com/oil-oil/oil-codex-title) 的命名规则适配到 DSH 官方会话 API，让标题随持续工作主线更新。

## 安装

在 DSH Market 中搜索 **Oil DSH Title** 并安装。命令行直装 GitHub Release 的方式：

```sh
dsh plugin --profile web add https://github.com/598829314/oil-dsh-title/releases/latest/download/oil-dsh-title.tgz
```

直接管理桌面 profile 时使用 `--profile desktop`。

安装后，在任意在线会话中发送一条具体任务；插件会在拿到本轮模型路由后异步更新标题。

## 标题格式

统一格式：

```text
类别 emoji + 对象｜持续目标
```

例如：

- `🧩 session-title｜验证事件监听`
- `🎨 登录表单｜优化页面布局`
- `🔎 模型评测｜比较准确率`

插件会参考最近几条用户消息，跟随主导语言，保留产品名和代码名，避免重复工作区提示与已存在标题；如果工作主线没有实质变化，会保持原标题稳定。

## DSH 集成方式

这是一个只运行在 Host 侧的 Cordis bundle。它监听所有在线会话的 `session/event`，通过官方 `sessionTitle.rename()` 更新标题。

它**不会**调用 `sessionTitle.register()`，也不会禁用 DSH 内置的 first-prompt provider，因此可以和默认标题栈并存，不修改 DSH 核心文件。

送入标题模型的输入有界且经过处理：

- 最近 5 条用户消息，每条最多 600 字符；
- 当前标题；
- 工作目录末级名称弱提示，不发送完整路径；
- 其它在线会话标题的有限列表。

插件不会向原会话追加命名消息。模型失败、输出格式错误、超时或标题冲突时，都会保留当前标题。

## 开发与测试

```sh
npm test
npm run check
```

测试覆盖标题格式校验、隐私过滤、JSON 解析、标准化，以及 LLM 的 `text-delta` 和 `block-end` 两种流式输出。

## 致谢与许可

命名规则和原始 Codex 实现来自 [oil-oil/oil-codex-title](https://github.com/oil-oil/oil-codex-title)。

本 DSH 适配版本使用 MIT License。
