# Windows 安装与验证

Windows 版本沿用 Python 实现，没有额外的文件锁依赖。当前已完成适配，自动化验收进行中；Windows 桌面端登录后的真实 Stop 触发、Luna 调用与列表刷新尚未实测。

## 安装条件

1. 安装 Python 3.10 或以上版本，确保 `py -3 --version` 可用。
2. 安装并登录兼容的 Codex CLI。可使用 PATH 中的原生 `codex.exe`，或标准 npm 安装提供的 `codex.cmd`。
3. 将完整插件安装到本机 Codex，通过官方 Hook 管理入口检查并信任定义。安装插件本身不代表 Hook 已获信任。

插件会将标准 npm 入口解析到原生 `codex.exe`，支持 x64/ARM64 对应包及新旧 vendor 布局；不会通过 `cmd.exe` 转义命名参数。无法识别的自定义启动脚本需要显式指定原生可执行文件。

在插件目录的 PowerShell 中运行：

```powershell
py -3 scripts/oil_codex_title.py doctor
py -3 scripts/oil_codex_title.py configure --codex-bin 'C:\Codex\codex.exe'
```

第二条仅在默认检测找不到正确 CLI 时使用，替换为实际存在的路径。

## 已适配的行为

- Hook 使用 Windows 专用命令 `py -3 -X utf8`，通过插件路径变量定位脚本。
- Windows 使用标准库 `msvcrt` 的内核字节锁；macOS/Linux 保留 `fcntl`。进程退出后自动释放锁。
- 子进程使用参数数组与 UTF-8 管道，支持路径中的中文、空格和标题中的 emoji。
- 后台 Codex 子进程不创建新的控制台窗口。
- 校验器拒绝将 Windows 盘符路径或 UNC 路径写入标题。

## 验收方式

自动化矩阵覆盖 Windows 的 Python 3.10/3.13，以及 macOS/Linux 的 Python 3.13。程序测试不调用付费模型；Windows 另安装官方 Codex CLI，检查原生入口解析与 App Server 连接。

账号环境中的最终检查仍需在 Windows Codex 中完成：新建正常话题、结束一轮有具体目标的对话、检查后台日志与实际显示标题，确认没有额外命名消息。没有这一步证据时，不宣称 Windows 桌面体验已经完整验收。

参考：[官方 Hook 的 Windows 命令与异步配置](https://learn.chatgpt.com/docs/hooks)、[Python Windows 文件锁](https://docs.python.org/3/library/msvcrt.html)。
