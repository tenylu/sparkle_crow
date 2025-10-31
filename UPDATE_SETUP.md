# CrowVPN 更新系统配置指南

## 概述

CrowVPN 使用 Cloudflare R2 来托管更新文件，实现自动更新功能。

## 配置步骤

### 1. 创建 Cloudflare R2 Bucket

1. 登录 Cloudflare 控制台
2. 导航到 "R2" > "Create bucket"
3. 创建一个名为 `crowvpn-updates` 的 bucket（或任何你喜欢的名字）

### 2. 配置 R2 公开访问

1. 在 R2 控制台，进入你的 bucket
2. 导航到 "Settings" > "Public access"
3. 启用 "Allow Public Access"
4. 设置自定义域名（推荐）或使用 Cloudflare 自动生成域名

### 3. 上传更新文件

在你的 R2 bucket 中需要上传以下文件：

#### YAML 版本文件

**latest.yml** (稳定版):
```yaml
version: 1.6.14
changelog: 修复了一些已知问题
```

**latest-beta.yml** (测试版):
```yaml
version: 1.6.15-beta
changelog: 新功能测试版本
```

#### 安装文件

根据你的平台架构，上传以下文件：

- `crowvpn-windows-1.6.14-x64-setup.exe`
- `crowvpn-windows-1.6.14-arm64-setup.exe`
- `crowvpn-macos-1.6.14-x64.pkg`
- `crowvpn-macos-1.6.14-arm64.pkg`
- `crowvpn-windows-1.6.14-portable.7z` (便携版)

#### SHA256 校验文件

为每个安装文件创建对应的 `.sha256` 文件。例如：

**crowvpn-windows-1.6.14-x64-setup.exe.sha256**:
```
a1b2c3d4e5f6...  crowvpn-windows-1.6.14-x64-setup.exe
```

可以使用以下命令生成 SHA256 文件：

```bash
# macOS/Linux
sha256sum crowvpn-windows-1.6.14-x64-setup.exe > crowvpn-windows-1.6.14-x64-setup.exe.sha256

# Windows (PowerShell)
Get-FileHash -Path crowvpn-windows-1.6.14-x64-setup.exe -Algorithm SHA256 | Out-File crowvpn-windows-1.6.14-x64-setup.exe.sha256
```

### 4. 配置代码中的 R2 URL

在 `src/main/resolve/autoUpdater.ts` 文件中，将以下 URL 替换为你的 R2 bucket 公开访问域名：

```typescript
// 第22行和第53行
const baseUrl = 'https://your-r2-bucket-url.r2.cloudflarestorage.com'
```

替换为你的实际域名，例如：
```typescript
const baseUrl = 'https://pub-xxxxxxxxxxxxx.r2.dev'
```

或者如果你使用自定义域名：
```typescript
const baseUrl = 'https://updates.crowvpn.com'
```

## 文件结构示例

你的 R2 bucket 应该有以下结构：

```
crowvpn-updates/
├── latest.yml
├── latest-beta.yml
├── crowvpn-windows-1.6.14-x64-setup.exe
├── crowvpn-windows-1.6.14-x64-setup.exe.sha256
├── crowvpn-windows-1.6.14-arm64-setup.exe
├── crowvpn-windows-1.6.14-arm64-setup.exe.sha256
├── crowvpn-macos-1.6.14-x64.pkg
├── crowvpn-macos-1.6.14-x64.pkg.sha256
├── crowvpn-macos-1.6.14-arm64.pkg
├── crowvpn-macos-1.6.14-arm64.pkg.sha256
├── crowvpn-windows-1.6.14-portable.7z
└── crowvpn-windows-1.6.14-portable.7z.sha256
```

## 测试更新功能

1. 确保所有文件已正确上传到 R2
2. 将代码中的 R2 URL 替换为实际域名
3. 编译并运行 CrowVPN
4. 在登录页面或主界面点击 "检查更新"
5. 验证系统能正确检测到新版本

## 注意事项

- 确保 R2 bucket 的公开访问设置正确
- 每个安装文件都必须有对应的 `.sha256` 校验文件
- YAML 文件中的版本号格式必须与安装文件名中的版本号匹配
- 建议使用自定义域名以获得更好的性能和可维护性

## 成本

Cloudflare R2 的定价：
- 存储：$0.015 / GB / 月
- Class A 操作（读取）：$4.50 / 百万次
- Class B 操作（写入/删除）：$0.36 / 百万次
- 出站流量：免费（无带宽费用）

对于典型的更新使用场景，成本非常低。

