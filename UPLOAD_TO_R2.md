# 上传文件到 Cloudflare R2 使用指南

## 配置 R2 凭证

在使用上传脚本之前，需要配置 Cloudflare R2 的凭证。

### 获取 R2 凭证

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 进入 R2 页面
3. 创建或选择一个 bucket
4. 创建 API Token:
   - 进入 "Manage R2 API Tokens"
   - 点击 "Create API Token"
   - 设置权限为 "Admin Read & Write"
   - 保存获得的 `Access Key ID` 和 `Secret Access Key`
5. 记录你的 Account ID（在 R2 页面右侧可以看到）

### 设置环境变量

在运行上传脚本之前，需要设置以下环境变量：

```bash
export R2_ACCOUNT_ID="your-account-id"
export R2_ACCESS_KEY_ID="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"
export R2_BUCKET="crowvpn-updates"  # 可选，默认为 crowvpn-updates
```

## 使用方法

### 上传单个文件

```bash
pnpm upload:r2 dist/crowvpn-macos-2.0.2-arm64.pkg
```

### 上传多个指定文件

```bash
pnpm upload:r2 dist/crowvpn-macos-2.0.2-arm64.pkg dist/crowvpn-macos-2.0.2-arm64.zip
```

### 上传目录下的所有 .pkg 和 .zip 文件

```bash
pnpm upload:r2 dist/ *.pkg *.zip
```

### 上传目录下的所有文件

```bash
pnpm upload:r2 dist/
```

## 功能特性

- **自动选择上传方式**：
  - 文件大小 < 100MB: 使用普通上传
  - 文件大小 ≥ 100MB: 使用分片上传（multipart upload）
  
- **分片上传**：
  - 每个分片 50MB
  - 支持断点续传
  - 上传过程中出现错误会自动取消并清理

- **进度显示**：
  - 显示当前上传的文件名
  - 分片上传时显示进度（如：分片 5/10）

## 示例

### 上传 macOS 构建产物

```bash
# 设置环境变量（只设置一次）
export R2_ACCOUNT_ID="your-account-id"
export R2_ACCESS_KEY_ID="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"

# 构建
pnpm build:mac

# 上传
pnpm upload:r2 dist/ *.zip *.pkg
```

### 完整发布流程

```bash
# 1. 构建
pnpm build:mac

# 2. 生成校验和
pnpm checksum .zip .pkg

# 3. 上传安装包和校验文件到 R2
pnpm upload:r2 dist/crowvpn-macos-2.0.2-arm64.zip dist/crowvpn-macos-2.0.2-arm64.pkg
pnpm upload:r2 dist/crowvpn-macos-2.0.2-arm64.zip.sha256 dist/crowvpn-macos-2.0.2-arm64.pkg.sha256

# 4. 更新 latest.yml
pnpm updater

# 5. 上传 latest.yml
pnpm upload:r2 latest.yml
```

## 注意事项

1. **文件大小限制**：
   - Cloudflare R2 网页界面限制：< 300MB
   - 使用本脚本无限制（使用 S3 API）

2. **上传速度**：
   - 分片上传会显示进度
   - 大文件可能需要一些时间

3. **错误处理**：
   - 上传失败会自动取消已上传的分片
   - 不会遗留不完整的上传

4. **凭证安全**：
   - 不要将凭证提交到 Git
   - 考虑使用 `.env` 文件（记得添加到 `.gitignore`）
   - 或者使用系统的环境变量管理工具

## 使用 .env 文件（可选）

创建 `.env` 文件（已添加到 `.gitignore`）：

```bash
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET=crowvpn-updates
```

然后修改脚本或使用 `dotenv` 包加载环境变量。

## 故障排查

1. **"请设置环境变量"错误**：
   - 确保所有环境变量都已设置
   - 检查变量名是否正确

2. **上传失败**：
   - 检查网络连接
   - 验证凭证是否正确
   - 确认 bucket 名称是否正确

3. **超时错误**：
   - 检查网络连接
   - 如果是大文件，可能需要等待更长时间

