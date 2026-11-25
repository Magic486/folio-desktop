# 拾页 Folio

拾页是一个 Windows 桌面应用。把一场比赛、一个项目或一次志愿活动的材料拖进会话，就能整理出带有原件依据的简历卡片，按分类或时间线查看。

## 下载和运行

在 [GitHub Releases](https://github.com/Magic486/folio-desktop/releases/latest) 下载 **Folio.exe**，保存到自己常用的位置，双击打开。发布包面向 Windows 10/11 x64，自带 Python 运行环境。窗口使用 Microsoft Edge WebView2；如果电脑缺少运行时，可安装 [Microsoft 提供的 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。

## 使用

- 每段经历建立一个会话，支持添加文件、文件夹和文字。可以预览证明材料，从 Word 文档提取图片，并裁剪证明附件。
- 输入框下方可选择「手动确认」或「全自动整理」。手动模式可逐份决定材料去向，再核对简历。自动模式由 Agent 整理附件并收录或更新卡片，遇到不确定的归属或冲突时留待核对。
- 在「经历简历」查看、编辑或打印已收录的经历。删除会话后，已收录的卡片和关联证明仍然保留。
- 「设置 → AI 连接」支持本地整理、兼容 Chat Completions 的 API，以及通过官方 Codex CLI 登录 ChatGPT。订阅登录需要另外安装 Codex CLI，并使用有对应权限的账号。选择远程 AI 后，发送的材料会提交给所选服务商。

## 从旧版迁移

打开此前保存经历的浏览器和原来的拾页地址，刷新后在「设置 → 工作区迁移」选择「导出迁移包」。在桌面应用的空工作区打开同一设置，导入生成的 `.folio.zip`。迁移包包含会话、简历卡片、个人资料和附件原件，请在本机妥善保管。AI 凭据需在桌面应用中单独设置。

桌面数据保存在 `%LOCALAPPDATA%\FolioDesktop`。替换或移动程序文件后，仍使用同一份工作区。程序运行期间会在本机回环地址的 52845 端口提供界面和 AI 接口，关闭窗口后服务结束。

## 从源码构建

在 Windows x64 安装 Python 3.13 后，在项目目录运行：

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-desktop.txt
.\.venv\Scripts\python desktop.py
```

生成与发布版相同形式的单文件程序：

```powershell
.\.venv\Scripts\python -m PyInstaller --noconfirm Folio.spec
```

输出为 `dist\Folio.exe`。桌面窗口由 pywebview 和 WebView2 提供，材料与卡片保存在本机 IndexedDB，PDF 读取使用 PDFium。第三方依赖的许可说明随构建打包，JSZip 的许可说明位于 `assets/jszip-LICENSE.md`。
