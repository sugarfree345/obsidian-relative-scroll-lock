# Relative Scroll Lock Strict

**左右两栏先分别定位，再锁定位置差。任意一栏到顶或到底，两栏一起停住。**

[English](README.en.md) · [下载安装包](https://github.com/sugarfree345/obsidian-relative-scroll-lock/releases/latest) · [反馈问题](https://github.com/sugarfree345/obsidian-relative-scroll-lock/issues)

本插件基于 [v-49 的 Relative Scroll Lock](https://github.com/v-49/obsidian-relative-scroll-lock) 1.0.2 修改。原版允许一栏到边界后另一栏继续滚动；本版将两栏限制在共同可滚动的范围内，反向滚动立即恢复，不需要先抵消到边界后的滚轮操作。

插件使用独立 ID：`relative-scroll-lock-strict`。**启用本版前，请停用原版 Relative Scroll Lock 及其他滚动同步插件。** 本版通过 GitHub Releases 发布；Obsidian 插件市场中的原版条目不是本修改版。

## 安装

### 直接安装成品

1. 从[最新发布页](https://github.com/sugarfree345/obsidian-relative-scroll-lock/releases/latest)下载 `relative-scroll-lock-strict-1.1.0.zip`。
2. 将其中的 `relative-scroll-lock-strict` 文件夹解压到仓库的插件目录，通常为 `.obsidian/plugins/`。
3. 重启 Obsidian，在「设置 → 第三方插件」启用 **Relative Scroll Lock Strict**。需关闭安全模式（Restricted mode）。

安装后应直接存在：

```text
你的仓库/.obsidian/plugins/relative-scroll-lock-strict/main.js
你的仓库/.obsidian/plugins/relative-scroll-lock-strict/manifest.json
你的仓库/.obsidian/plugins/relative-scroll-lock-strict/styles.css
```

不要多套一层文件夹。发布页自动生成的 Source code 压缩包需要自行构建，请下载上面指定的成品 ZIP。

### 已安装 BRAT 的用户

在 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 中添加仓库 `sugarfree345/obsidian-relative-scroll-lock`。发布附件同时提供 BRAT 所需的独立 `main.js`、`manifest.json` 和 `styles.css`。

## 使用

1. 在主区域左右打开两个 Markdown 笔记栏，可以是同一篇文章。
2. 分别调整位置。如果要连续双栏阅读，让右栏开头接着左栏末尾。
3. 点击底部状态栏的「滚动锁：松开」，或使用侧边工具栏、笔记标题栏的锁按钮。
4. 在任意一栏滚动，两栏移动相同距离；移动距离由剩余空间更少的那栏决定。
5. 任意一栏到顶或到底，两栏在该方向一起停住。反向滚动即可立即恢复联动。

按住 **Alt** 滚动，可单独调整鼠标所在的一栏；松开 Alt 后按新的位置差继续同步。再次点击锁按钮可解除同步。默认不占用快捷键，可在「设置 → 快捷键」中为本插件的「锁紧 / 松开」命令自行设置。

如果两个标签页原先使用 Obsidian 的原生关联功能，点击锁紧会解除它们的原生关联；解除滚动锁不会自动恢复该关联，可从标签页菜单重新创建。

## 支持范围与限制

- 仅桌面版 Obsidian **1.13.7+**，主区域恰好两个左右并排的 Markdown 栏。
- 沿用原版的阅读模式、实时预览、源码模式适配；本修改版实际完成的验证范围见[验证说明](docs/validation.md)。
- 不支持 PDF、Canvas、手机、独立弹出窗口、上下分栏，或主区域同时显示三栏以上。
- 更换文件、显示模式或切换到不支持的布局后，自动解除同步。
- 按像素位移同步，不会自动识别相邻段落。连续阅读建议两栏宽度、字体和显示模式保持一致；编辑、折叠、调整窗口、图片加载可能需要重新定位。
- 滚轮在实际滚动前限制共同位移；滚动条等其他滚动来源通过滚动事件纠正。第三方编辑器插件的行为仍需具体检查。
- Ctrl/Meta 加滚轮缩放、横向滚动及内部可独立滚动的元素保留正常行为。

## 隐私与许可

插件不发送网络请求、不收集遥测、不要求账号，也不修改正文。它读取视图和滚动容器状态。锁紧时可能解除原生标签页关联，Obsidian 会保存这一工作区状态；本插件不保存配对关系或滚动位置。

采用 [MIT 许可](LICENSE)，保留原作者 **v-49** 的 2026 年版权声明；修改版由 **sugarfree345** 维护。与 Obsidian 官方无隶属关系。

## 自行构建

```sh
npm ci
npm run check
npm run package
```

生成成品文件夹 `dist/relative-scroll-lock-strict/`，以及可直接解压安装的 `dist/relative-scroll-lock-strict-1.1.0.zip`。`dist/` 中还会生成独立发布附件及 `SHA256SUMS.txt` 校验文件。ZIP 使用排序后的文件和固定时间戳，相同输入可重复生成相同压缩包。构建和自动化测试均不需要个人笔记仓库。
