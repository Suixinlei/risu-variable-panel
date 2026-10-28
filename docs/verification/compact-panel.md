# 紧凑布局验收

隔离浏览器检查前列出的失败方式：短值仍占两行；JSON 撑满面板；聚焦展开后无法收回；文本被截断且无法滚动编辑；窄屏出现水平溢出；工具栏或底栏被挤出；搜索和编辑导致值丢失。使用模拟宿主和虚构变量加载真实插件脚本，不访问用户存档。此检查不替代 RisuAI 宿主内集成验收。

## 2026-10-28 实测结果

在 Codex In-app Browser 加载真实插件脚本，宿主 API 使用虚构数据模拟。

- 24 个短值输入框高度约 31px；长 JSON 默认约 84px。
- 点击 JSON 输入框展开至 240px，点击搜索框失焦后收回至约 84px。
- 搜索 stat_1 后编辑首项为 42，保存成功，清除搜索后仍为 42。
- 窄屏预览：工具栏换行、底栏可见；DOM clientWidth 与 scrollWidth 均为 433，无水平溢出（浏览器缩放导致 CSS 宽度与请求的 390px 视口有差异）。
- node --check 与 git diff --check 通过。
- 未验证真实宿主、移动软键盘、刷新后的持久化。

## 复现

在插件仓库运行 `python3 -m http.server 8769 --bind 127.0.0.1`，打开 `/docs/verification/compact-preview.html`。

1. 查看短值与 inventory JSON 的行高。
2. 点击 JSON，再点击搜索框，检查展开和收起。
3. 搜索 stat_1，编辑第一项、保存，清空搜索检查值。
4. 缩窄窗口，确认工具栏、底栏可见且页面无横向滚动。

截图：`compact-desktop.jpg`、`compact-mobile.jpg`。预览仅模拟内存保存，刷新会重置虚构数据。
