# 给 RisuAI 做了个变量面板，查看和修改聊天变量更方便了

做了一个 RisuAI 插件「变量面板」，适合玩带变量的角色卡，或者调试自己的卡。

- 表格里直接查看、修改当前聊天变量，支持搜索、新增、重命名和删除。
- JSON 对象和数组会格式化显示，方便编辑。
- 可以查看尚未写入的默认变量，以及当前聊天的全局变量覆盖。
- 对使用 `{{setvar::键::值}}` 协议的卡，提供变量即时更新加速。

单个 JS 文件，无需编译。下载后在 RisuAI → 设置 → 插件 → `+` 导入，进入聊天点 🧮 就能打开。

下载：https://github.com/Suixinlei/risu-variable-panel/releases/latest
源码与说明：https://github.com/Suixinlei/risu-variable-panel

需要支持插件 API 3.0 的 RisuAI。插件编辑的是 RisuAI 变量；卡片自己的状态文本需要接入变量宏，才会与这些变量联动。

MIT 开源，欢迎试用和反馈！遇到问题请附 RisuAI 版本、运行平台和复现步骤。

---

配图：同目录 `panel.png`（现有真实界面截图）。发布时删除本行和分隔线以上的标题格式也可以。
