# 系统菜单栏图标修改指南

## 图标文件位置

所有图标文件位于 `resources/` 目录下：

- **macOS**: `resources/iconTemplate.png` (64x64 PNG)
- **Windows**: `resources/icon.ico` (包含多个尺寸的 ICO 文件)
- **Linux**: `resources/icon.png` (512x512 PNG)

## 图标要求和格式

### macOS (iconTemplate.png)
- **格式**: PNG
- **尺寸**: 64x64 像素
- **特点**: Template 图标，必须是单色图标
- **颜色**: 使用黑色或深灰色，系统会自动反转颜色以适应深色/浅色主题
- **背景**: 透明
- **注意事项**: 
  - 不要使用彩色
  - 图标应该是单色的线条图形
  - 系统菜单栏高度为 16 像素，图标会自动缩放

### Windows (icon.ico)
- **格式**: ICO
- **尺寸**: 包含多个尺寸（32x32, 16x16 等）
- **特点**: Windows 图标文件，包含多个分辨率
- **工具**: 
  - 可以用在线工具将 PNG 转换为 ICO
  - 或在 macOS 上使用 `iconutil`
  - 推荐使用 [ICO Convert](https://iconverticons.com/) 或类似工具

### Linux (icon.png)
- **格式**: PNG
- **尺寸**: 512x512 像素（推荐）
- **特点**: 标准 PNG 图标
- **背景**: 透明或纯色

## 修改步骤

### 方法 1: 直接替换文件

1. 准备你的图标文件：
   - macOS: 创建 64x64 的单色透明 PNG
   - Windows: 创建包含多尺寸的 ICO 文件
   - Linux: 创建 512x512 的透明 PNG

2. 替换 `resources/` 目录下的对应文件

3. 重启应用即可生效

### 方法 2: 创建新图标文件

如果你想保留原图标并添加新图标：

1. 在 `resources/` 目录添加新图标文件，例如：
   - `resources/crowIconTemplate.png` (macOS)
   - `resources/crowIcon.ico` (Windows)
   - `resources/crowIcon.png` (Linux)

2. 修改 `src/main/resolve/tray.ts` 文件，更新导入路径：

```typescript
// 原代码
import iconTemplate from '../../../resources/iconTemplate.png?asset'
import pngIcon from '../../../resources/icon.png?asset'
import icoIcon from '../../../resources/icon.ico?asset'

// 改为
import iconTemplate from '../../../resources/crowIconTemplate.png?asset'
import pngIcon from '../../../resources/crowIcon.png?asset'
import icoIcon from '../../../resources/crowIcon.ico?asset'
```

## macOS Template 图标创建技巧

macOS 的系统菜单栏图标必须是 Template 图标：

1. 使用黑色或深灰色设计图标
2. 背景必须透明
3. 避免使用渐变和半透明效果
4. 线条粗细适中，确保在 16px 高度下清晰可见

### 推荐设计工具
- **Sketch**
- **Figma**
- **Adobe Illustrator**
- **在线工具**: [Canva](https://www.canva.com/)、[Figma](https://www.figma.com/)

## 图标预览

修改后，你可以通过以下方式预览：

### macOS
- 直接运行应用查看系统菜单栏
- 使用 `Quick Look` (空格键) 预览 PNG 文件
- 在线预览: [Icon Preview](https://icon.kitchen/)

### Windows
- 运行应用查看系统托盘
- 右键 `.ico` 文件选择 "属性" 查看预览

### Linux
- 运行应用查看系统托盘
- 使用图片查看器预览 PNG

## 注意事项

⚠️ **重要**: 修改图标文件后，需要重新启动应用才能看到效果

⚠️ **备份**: 建议在修改前备份原图标文件

⚠️ **格式**: 确保文件格式和尺寸正确，错误的格式可能导致图标显示异常

## 当前应用名称

应用名称: **CrowVPN** (之前叫 Sparkle)

如果需要修改应用名称，需要修改：
- `package.json` 中的 `name` 字段
- `src/main/index.ts` 中的窗口标题
- `src/renderer/index.html` 中的 title
- `src/main/resolve/tray.ts` 中的 tooltip

## 连接状态图标

当前实现：
- **未连接**: 灰色图标（macOS 使用 template mode）
- **已连接**: 白色图标（macOS 关闭 template mode）
- **菜单显示**: 状态栏菜单顶部显示"状态：已连接"或"状态：未连接"

如果需要改变图标颜色，请参考 `src/main/resolve/tray.ts` 中的 `updateTrayIconBrightness` 函数。

