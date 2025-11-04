# Cloudflare R2 更新包文件结构说明

## 基础 URL
所有文件都托管在：`https://cloud.crowmesh.com/`

## 必需文件

### 1. 更新信息文件（YAML 格式）

#### 稳定版更新信息
- **文件名**：`latest.yml`
- **URL**：`https://cloud.crowmesh.com/latest.yml`
- **格式**：
```yaml
version: "2.0.4"
changelog: |
  # 更新日志
  - 修复了一些已知问题
  - 优化了性能
```

#### 测试版更新信息
- **文件名**：`latest-beta.yml`
- **URL**：`https://cloud.crowmesh.com/latest-beta.yml`
- **格式**：与 `latest.yml` 相同

### 2. 安装包文件

#### macOS 安装包
- **Intel (x64)**：`crowvpn-macos-{version}-x64.pkg`
  - 示例：`crowvpn-macos-2.0.4-x64.pkg`
- **Apple Silicon (ARM64)**：`crowvpn-macos-{version}-arm64.pkg`
  - 示例：`crowvpn-macos-2.0.4-arm64.pkg`

#### Windows 安装包
- **x64 安装版**：`crowvpn-windows-{version}-x64-setup.exe`
  - 示例：`crowvpn-windows-2.0.4-x64-setup.exe`
- **ARM64 安装版**：`crowvpn-windows-{version}-arm64-setup.exe`
  - 示例：`crowvpn-windows-2.0.4-arm64-setup.exe`
- **x64 便携版**：`crowvpn-windows-{version}-x64-portable.7z`
  - 示例：`crowvpn-windows-2.0.4-x64-portable.7z`
- **ARM64 便携版**：`crowvpn-windows-{version}-arm64-portable.7z`
  - 示例：`crowvpn-windows-2.0.4-arm64-portable.7z`

### 3. SHA256 校验文件

每个安装包文件都需要对应的 SHA256 校验文件，文件名格式：`{安装包文件名}.sha256`

**示例**：
- `crowvpn-macos-2.0.4-x64.pkg.sha256`
- `crowvpn-macos-2.0.4-arm64.pkg.sha256`
- `crowvpn-windows-2.0.4-x64-setup.exe.sha256`
- `crowvpn-windows-2.0.4-arm64-setup.exe.sha256`
- `crowvpn-windows-2.0.4-x64-portable.7z.sha256`
- `crowvpn-windows-2.0.4-arm64-portable.7z.sha256`

**SHA256 文件内容格式**：
```
{sha256_hash}
```
或
```
{sha256_hash}  {文件名}
```

## 完整文件结构示例

假设版本为 `2.0.4`，R2 上需要的文件结构如下：

```
cloud.crowmesh.com/
├── latest.yml                          # 稳定版更新信息
├── latest-beta.yml                     # 测试版更新信息
├── crowvpn-macos-2.0.4-x64.pkg        # macOS Intel 安装包
├── crowvpn-macos-2.0.4-x64.pkg.sha256 # macOS Intel 校验文件
├── crowvpn-macos-2.0.4-arm64.pkg      # macOS Apple Silicon 安装包
├── crowvpn-macos-2.0.4-arm64.pkg.sha256 # macOS Apple Silicon 校验文件
├── crowvpn-windows-2.0.4-x64-setup.exe    # Windows x64 安装版
├── crowvpn-windows-2.0.4-x64-setup.exe.sha256 # Windows x64 安装版校验文件
├── crowvpn-windows-2.0.4-arm64-setup.exe    # Windows ARM64 安装版
├── crowvpn-windows-2.0.4-arm64-setup.exe.sha256 # Windows ARM64 安装版校验文件
├── crowvpn-windows-2.0.4-x64-portable.7z    # Windows x64 便携版
├── crowvpn-windows-2.0.4-x64-portable.7z.sha256 # Windows x64 便携版校验文件
├── crowvpn-windows-2.0.4-arm64-portable.7z    # Windows ARM64 便携版
└── crowvpn-windows-2.0.4-arm64-portable.7z.sha256 # Windows ARM64 便携版校验文件
```

## 更新流程

1. **检查更新**：应用从 `latest.yml` 或 `latest-beta.yml` 读取版本信息
2. **版本比较**：比较当前版本和最新版本，只允许从低版本更新到高版本
3. **下载安装包**：根据平台和架构下载对应的安装包文件
4. **验证校验和**：下载对应的 `.sha256` 文件并验证
5. **安装更新**：安装包验证通过后执行安装

## 注意事项

1. **文件命名必须严格匹配**：文件名格式必须完全符合上述规则
2. **版本号格式**：版本号必须是 `x.y.z` 格式（如 `2.0.4`）
3. **SHA256 校验是必需的**：每个安装包都必须有对应的 SHA256 校验文件
4. **文件访问权限**：确保所有文件都是公开可访问的（或配置了正确的 CORS 规则）
5. **Content-Type**：
   - YAML 文件：`application/octet-stream` 或 `text/yaml`
   - 安装包文件：`application/octet-stream`
   - SHA256 文件：`text/plain` 或 `application/octet-stream`

## 生成 SHA256 校验文件

可以使用项目中的 `checksum.mjs` 脚本自动生成：

```bash
pnpm checksum .pkg .exe .7z
```

这会在 `dist/` 目录下为所有匹配的文件生成对应的 `.sha256` 文件。
