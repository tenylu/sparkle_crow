# Sparkle - VPN 客户端

一个基于 Electron + React 的跨平台 VPN 客户端，支持多种代理协议和智能路由。

## ✨ 特性

- 🚀 **高性能代理**: 基于 Mihomo 核心，支持多种代理协议
- 🎯 **智能路由**: 支持智能模式和全局模式切换
- 🌍 **全球节点**: 自动获取并管理订阅节点
- 📊 **实时监控**: 流量使用、连接状态实时显示
- 🔒 **安全可靠**: 加密传输，保护用户隐私
- 💻 **跨平台**: 支持 Windows、macOS、Linux
- 🎨 **现代化 UI**: 简洁美观的用户界面
- 🧩 **组件化设计**: 易于维护和扩展

## 📋 系统要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0

## 🛠️ 安装

```bash
# 克隆项目
git clone https://github.com/crowmesh/sparkle.git
cd sparkle

# 安装依赖
pnpm install

# 启动开发模式
pnpm dev

# 构建应用
pnpm build:win   # Windows
pnpm build:mac   # macOS
pnpm build:linux # Linux
```

## 📚 项目结构

```
sparkle_crow/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── api/          # API 客户端（Xboard、订阅解析）
│   │   ├── config/       # 配置管理
│   │   ├── core/         # 核心功能（Mihomo 管理）
│   │   ├── resolve/      # 功能模块（托盘、菜单、监控等）
│   │   ├── sys/          # 系统操作（代理、自动启动等）
│   │   └── utils/        # 工具函数
│   ├── renderer/         # React 渲染进程
│   │   └── src/
│   │       ├── components/  # 可复用组件
│   │       ├── stores/      # 状态管理
│   │       ├── pages/       # 页面组件
│   │       └── utils/       # 工具函数
│   ├── preload/          # 预加载脚本
│   └── shared/           # 共享类型定义
├── extra/                # 静态资源
└── build/                # 构建配置
```

## 🎯 核心功能

### 1. VPN 连接管理
- 节点自动检测和延迟测试
- 智能节点选择
- 连接/断开切换
- 虚拟网卡（TUN）支持

### 2. 代理模式
- **智能模式**: 根据规则自动分流
- **全局模式**: 所有流量通过代理

### 3. 节点管理
- 节点列表展示
- 实时延迟检测
- 国家标识显示
- 节点切换

### 4. 用户信息
- 账户信息
- 套餐详情
- 流量使用情况
- 有效期剩余时间

### 5. 系统集成
- 系统代理设置
- 系统托盘菜单
- 开机自动启动
- 共享代理（局域网）

## 🔧 配置

### 应用配置

配置存储在用户数据目录：
- **Windows**: `%APPDATA%/sparkle`
- **macOS**: `~/Library/Application Support/sparkle`
- **Linux**: `~/.config/sparkle`

### Xboard 配置

登录信息存储在 `xboard-config.json` 中，包含：
- 面板地址
- 认证令牌
- 用户邮箱

## 🚀 开发

### 运行开发服务器

```bash
pnpm dev
```

### 代码检查

```bash
pnpm lint
pnpm typecheck
```

### 格式化代码

```bash
pnpm format
```

## 📖 API 文档

### Xboard API 集成

项目基于 Xboard/V2Board 面板，API 文档参考：
- [官方 API 文档](https://github.com/cdnf/v2board-api-document)

主要 API 端点：
- 登录: `POST /api/v1/passport/auth/login`
- 用户信息: `GET /api/v1/user/info`
- 获取订阅: `GET /api/v1/user/getSubscribe`

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📝 许可证

MIT License

## 👤 作者

crowmesh

## 🔗 链接

- [GitHub](https://github.com/crowmesh/sparkle)
- [主页](https://github.com/crowmesh/sparkle)

---

Made with ❤️ by sparkle team

