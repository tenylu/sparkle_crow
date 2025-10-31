# macOS 代码签名配置指南

## 问题
macOS 打开应用时提示"损坏"的原因是应用未经过 Apple 代码签名和公证（Notarization）。这是 macOS Gatekeeper 的安全机制。

## 解决方案

### 方案 1：添加代码签名配置（推荐）

需要 Apple Developer 账号（年费 $99）。配置步骤如下：

#### 1. 准备 Apple Developer 账号和证书

- 登录 [Apple Developer](https://developer.apple.com)
- 在 Certificates, Identifiers & Profiles 中创建：
  - **证书类型**：Developer ID Application
  - **证书用途**：用于签名 macOS 应用程序

#### 2. 创建 App-Specific Password（用于公证）

- 访问 [appleid.apple.com](https://appleid.apple.com)
- 生成 App-Specific Password 供公证使用

#### 3. 配置 `electron-builder.yml`

```yaml
mac:
  target:
    - dmg
    - pkg
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    - NSCameraUsageDescription: Application requests access to the device's camera.
    - NSMicrophoneUsageDescription: Application requests access to the device's microphone.
    - NSDocumentsFolderUsageDescription: Application requests access to the user's Documents folder.
    - NSDownloadsFolderUsageDescription: Application requests access to the user's Downloads folder.
  # 启用公证
  notarize:
    teamId: "YOUR_TEAM_ID"  # 从 Apple Developer 获取
  identity: "Developer ID Application: Your Name (YOUR_TEAM_ID)"  # 证书名称
  artifactName: ${name}-macos-${version}-${arch}.${ext}
  hardenedRuntime: true  # 启用运行时保护
  gatekeeperAssess: false  # 禁用 Gatekeeper 评估
  
  # 设置公证所需的权限
  entitlements: build/entitlements.mac.plist
  
# 添加公证配置
afterSign: scripts/notarize.mjs
```

#### 4. 创建公证脚本

创建 `scripts/notarize.mjs`：

```javascript
const { notarize } = require('@electron/notarize');

exports.default = async function(context) {
  const { electronPlatformName, appOutDir } = context;
  
  // 只对 macOS 进行公证
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appName}...`);

  return await notarize({
    tool: 'notarytool',  // 使用 notarytool（推荐）
    teamId: process.env.APPLE_TEAM_ID,
    appPath: appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
  });
};
```

#### 5. 安装公证依赖

```bash
pnpm add -D @electron/notarize
```

#### 6. 在 GitHub Actions 中配置环境变量

在 `.github/workflows/build.yml` 中添加 secrets：

```yaml
- name: Build
  env:
    npm_config_arch: ${{ matrix.arch }}
    npm_config_target_arch: ${{ matrix.arch }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
```

#### 7. 在 GitHub 仓库中添加 Secrets

访问 `Settings > Secrets and variables > Actions`，添加：
- `APPLE_TEAM_ID`: 你的 Team ID（10位字符）
- `APPLE_ID`: 你的 Apple ID
- `APPLE_APP_SPECIFIC_PASSWORD`: 生成的 App-Specific Password

---

### 方案 2：用户手动绕过检查（临时方案）

如果暂时无法配置签名，可以指导用户手动绕过 Gatekeeper：

#### 方法 A：右键打开（推荐）

1. 右键点击 `.dmg` 或 `.app`
2. 选择「打开」
3. 在弹出的安全提示中点击「打开」

系统会将该应用添加到例外列表，之后可直接运行。

#### 方法 B：使用命令移除隔离属性

```bash
sudo xattr -rd com.apple.quarantine /Applications/CrowVPN.app
```

#### 方法 C：在「系统设置」中允许

1. 打开「系统设置」>「隐私与安全性」
2. 滚动到底部
3. 点击「仍要打开」按钮

---

### 方案 3：不公证但禁用 Gatekeeper（不推荐）

**警告**：这需要用户禁用系统安全机制，不推荐用于生产环境。

让用户在终端执行：
```bash
sudo spctl --master-disable
```

这会禁用 Gatekeeper，但会降低系统安全性。

---

## 推荐做法

1. **开发阶段**：使用方案 2（右键打开）
2. **生产环境**：必须使用方案 1（代码签名 + 公证）

## 参考链接

- [Apple Developer - Code Signing](https://developer.apple.com/documentation/security/code_signing_services)
- [electron-builder - macOS Code Signing](https://www.electron.build/code-signing#macos-code-signing)
- [electron-builder - Notarization](https://www.electron.build/code-signing#notarization)
- [Apple Notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)

