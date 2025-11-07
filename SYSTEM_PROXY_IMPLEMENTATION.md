# 全局代理实现方式详解

## 1. 架构概览

全局代理通过修改系统代理设置实现，支持两种模式：

- **手动代理模式（Manual）**：直接设置代理服务器地址
- **PAC 模式（Auto）**：使用 PAC 脚本动态决定代理

## 2. 核心组件

### 2.1 服务程序：sysproxy

```typescript
// src/main/utils/dirs.ts (98-101行)
export function sysproxyPath(): string {
  const isWin = process.platform === 'win32'
  return path.join(resourcesFilesDir(), `sysproxy${isWin ? '.exe' : ''}`)
}
```

- **位置**：`resources/files/sysproxy`（或 `.exe`）
- **功能**：调用系统 API 设置/取消系统代理
- **平台**：Windows/macOS/Linux 均有对应版本

### 2.2 PAC 服务器

```typescript
// src/main/resolve/server.ts (76-95行)
export async function startPacServer(): Promise<void> {
  await stopPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode = 'manual', host: cHost, pacScript } = sysProxy || {}
  if (mode !== 'auto') {
    return  // 非 PAC 模式不启动
  }
  const host = cHost || '127.0.0.1'
  let script = pacScript || defaultPacScript
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  script = script.replaceAll('%mixed-port%', port.toString())
  
  // 从 10000 端口开始查找可用端口
  pacPort = await findAvailablePort(10000)
  
  pacServer = http
    .createServer(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' })
      res.end(script)  // 返回 PAC 脚本
    })
    .listen(pacPort, host)
}
```

**默认 PAC 脚本**：

```javascript
function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
```

### 2.3 macOS Helper（系统服务）

macOS 使用系统 Helper 服务来设置代理，避免每次都需要授权：

- **Helper 文件路径**：`/Library/PrivilegedHelperTools/sparkle.helper`
- **LaunchDaemon 配置文件**：`/Library/LaunchDaemons/sparkle.helper.plist`
- **Socket 路径**：`/tmp/sparkle-helper.sock`
- **通信方式**：通过 HTTP API over Unix Socket

## 3. 代理设置流程

### 3.1 触发入口

```typescript
// src/main/sys/sysproxy.ts (51-62行)
export async function triggerSysProxy(enable: boolean, onlyActiveDevice: boolean): Promise<void> {
  if (net.isOnline()) {
    if (enable) {
      await setSysProxy(onlyActiveDevice)  // 开启代理
    } else {
      await disableSysProxy(onlyActiveDevice)  // 关闭代理
    }
  } else {
    // 网络未连接，延迟 5 秒重试
    if (triggerSysProxyTimer) clearTimeout(triggerSysProxyTimer)
    triggerSysProxyTimer = setTimeout(() => triggerSysProxy(enable, onlyActiveDevice), 5000)
  }
}
```

### 3.2 开启代理逻辑

```typescript
// src/main/sys/sysproxy.ts (64-281行)
async function setSysProxy(onlyActiveDevice: boolean): Promise<void> {
  // 1. 设置平台特定的默认绕过列表
  if (process.platform === 'linux') defaultBypass = [...]
  if (process.platform === 'darwin') defaultBypass = [...]
  if (process.platform === 'win32') defaultBypass = [...]
  
  // 2. 启动 PAC 服务器（如果使用 PAC 模式）
  await startPacServer()
  
  // 3. 获取配置
  const { sysProxy } = await getAppConfig()
  const { mode, host, bypass = defaultBypass } = sysProxy
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  const execFilePromise = promisify(execFile)
  
  // 4. 根据模式设置代理
  switch (mode || 'manual') {
    case 'auto':  // PAC 模式
      if (process.platform === 'darwin') {
        // macOS: 通过 Helper 的 HTTP API 设置 PAC URL
        const response = await axios.post(
          'http://localhost/pac',
          {
            url: `http://${host || '127.0.0.1'}:${pacPort}/pac`,
            only_active_device: onlyActiveDevice
          },
          {
            socketPath: helperSocketPath,  // Unix Socket
            validateStatus: () => true,
            timeout: 5000
          }
        )
      } else if (process.platform === 'win32') {
        // Windows: 通过执行程序设置 PAC URL
        await execFilePromise(sysproxyPath(), [
          'pac',
          '--url',
          `http://${host || '127.0.0.1'}:${pacPort}/pac`
        ])
      } else {
        // Linux: 通过执行程序设置 PAC URL
        await execFilePromise(sysproxyPath(), [
          'pac',
          '--url',
          `http://${host || '127.0.0.1'}:${pacPort}/pac`
        ])
      }
      break
      
    case 'manual':  // 手动代理模式
      if (port != 0) {
        if (process.platform === 'darwin') {
          // macOS: 通过 Helper 的 HTTP API 设置代理
          const response = await axios.post(
            'http://localhost/proxy',
            {
              server: `${host || '127.0.0.1'}:${port}`,
              bypass: bypass.join(','),
              only_active_device: onlyActiveDevice
            },
            {
              socketPath: helperSocketPath,  // Unix Socket
              validateStatus: () => true,
              timeout: 5000
            }
          )
        } else if (process.platform === 'win32') {
          // Windows: 通过执行程序设置代理
          await execFilePromise(sysproxyPath(), [
            'proxy',
            '--server',
            `${host || '127.0.0.1'}:${port}`,
            '--bypass',
            bypass.join(';')  // Windows 使用分号分隔
          ])
        } else {
          // Linux: 通过执行程序设置代理
          await execFilePromise(sysproxyPath(), [
            'proxy',
            '--server',
            `${host || '127.0.0.1'}:${port}`,
            '--bypass',
            bypass.join(',')  // Linux 使用逗号分隔
          ])
        }
      }
      break
  }
}
```

### 3.3 关闭代理逻辑

```typescript
// src/main/sys/sysproxy.ts (283-319行)
export async function disableSysProxy(onlyActiveDevice: boolean): Promise<void> {
  await stopPacServer()  // 停止 PAC 服务器
  
  if (process.platform === 'darwin') {
    // macOS: 通过 Helper 的 HTTP API 禁用代理
    const response = await axios.post(
      'http://localhost/disable',
      { only_active_device: onlyActiveDevice },
      {
        socketPath: helperSocketPath,
        validateStatus: () => true,
        timeout: 5000
      }
    )
  } else {
    // Windows/Linux: 通过执行程序禁用代理
    await execFilePromise(sysproxyPath(), ['disable'])
  }
}
```

## 4. 平台差异

### 4.1 Windows

**手动代理模式**：
```typescript
execFilePromise(sysproxyPath(), [
  'proxy',
  '--server', '127.0.0.1:7890',
  '--bypass', 'localhost;127.*;192.168.*;...'  // 使用分号分隔
])
```

**PAC 模式**：
```typescript
execFilePromise(sysproxyPath(), [
  'pac',
  '--url', 'http://127.0.0.1:10000/pac'
])
```

**特点**：
- 使用 `sysproxy.exe`
- 绕过列表使用分号（`;`）分隔
- 通过任务计划程序获得管理员权限
- 首次启动需要管理员权限创建任务计划

### 4.2 macOS

**Helper 检查与启动**：
```typescript
// 检查 Helper socket 是否存在
if (!existsSync(helperSocketPath)) {
  // 检查 Helper 是否已安装
  const helperInstalled = await isHelperInstalled()
  if (!helperInstalled) {
    throw new Error('系统代理 Helper 未安装。请重新安装应用程序以安装 Helper。')
  }
  // Helper 已安装但未运行，尝试启动
  await restartHelper()
}
```

**手动代理模式（通过 Helper）**：
```typescript
const response = await axios.post(
  'http://localhost/proxy',
  {
    server: '127.0.0.1:7890',
    bypass: 'localhost,127.0.0.1/8,...',  // 使用逗号分隔
    only_active_device: onlyActiveDevice
  },
  {
    socketPath: '/tmp/sparkle-helper.sock',
    validateStatus: () => true,
    timeout: 5000
  }
)
```

**PAC 模式（通过 Helper）**：
```typescript
const response = await axios.post(
  'http://localhost/pac',
  {
    url: 'http://127.0.0.1:10000/pac',
    only_active_device: onlyActiveDevice
  },
  {
    socketPath: '/tmp/sparkle-helper.sock',
    validateStatus: () => true,
    timeout: 5000
  }
)
```

**特点**：
- 绕过列表使用逗号（`,`）分隔
- 通过 Helper 服务避免每次授权（需要安装 Helper）
- 支持 `onlyActiveDevice` 选项（仅活跃接口）
- Helper 通过 Unix Socket 提供 HTTP API

### 4.3 Linux

**手动代理模式**：
```typescript
execFilePromise(sysproxyPath(), [
  'proxy',
  '--server', '127.0.0.1:7890',
  '--bypass', 'localhost,.local,127.0.0.1/8,...'  // 使用逗号分隔
])
```

**特点**：
- 绕过列表使用逗号（`,`）分隔
- 需要 root 权限或 setuid

## 5. 默认绕过列表

各平台的默认绕过规则：

### Windows
```typescript
[
  'localhost',
  '127.*',
  '192.168.*',
  '10.*',
  '172.16.*', '172.17.*', ... '172.31.*',  // 所有私有网段
  '<local>'
]
```

### macOS
```typescript
[
  '127.0.0.1/8',
  '192.168.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
  'localhost',
  '*.local',
  '*.crashlytics.com',
  '<local>'
]
```

### Linux
```typescript
[
  'localhost',
  '.local',
  '127.0.0.1/8',
  '192.168.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '::1'
]
```

## 6. macOS Helper 服务

### 6.1 Helper 安装

```typescript
// src/main/sys/sysproxy.ts (364-461行)
export async function installHelper(): Promise<void> {
  // 1. 检查 Helper 文件是否存在
  const helperPath = sysproxyPath()
  if (!existsSync(helperPath)) {
    throw new Error('Helper 文件不存在')
  }
  
  // 2. 创建安装脚本
  const scriptPath = join(tmpdir(), `install-helper-${Date.now()}.sh`)
  const installScript = `
    # 复制 Helper 文件到系统目录
    cp "${helperPath}" /Library/PrivilegedHelperTools/sparkle.helper
    chown root:wheel /Library/PrivilegedHelperTools/sparkle.helper
    chmod 755 /Library/PrivilegedHelperTools/sparkle.helper
    
    # 创建 LaunchDaemon 配置文件
    cat > /Library/LaunchDaemons/sparkle.helper.plist << 'EOF'
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>sparkle.helper</string>
        ...
      </dict>
    </plist>
    EOF
    
    # 加载并启动服务
    launchctl load /Library/LaunchDaemons/sparkle.helper.plist
    launchctl start sparkle.helper
  `
  
  // 3. 通过 osascript 以管理员权限执行安装脚本
  await execPromise(
    `osascript -e 'do shell script "${installScript}" with administrator privileges'`
  )
}
```

### 6.2 Helper 检查

```typescript
// src/main/sys/sysproxy.ts (320-363行)
export async function isHelperInstalled(): Promise<boolean> {
  // 1. 检查 Helper 文件是否存在
  const helperPath = '/Library/PrivilegedHelperTools/sparkle.helper'
  const plistPath = '/Library/LaunchDaemons/sparkle.helper.plist'
  
  if (!existsSync(helperPath) || !existsSync(plistPath)) {
    return false
  }
  
  // 2. 尝试通过 Socket 连接检查 Helper 是否运行
  try {
    await axios.get('http://localhost/ping', {
      socketPath: helperSocketPath,
      timeout: 2000
    })
    return true
  } catch {
    // Helper 文件存在但未运行，尝试启动
    try {
      await restartHelper()
      await axios.get('http://localhost/ping', {
        socketPath: helperSocketPath,
        timeout: 2000
      })
      return true
    } catch {
      return false
    }
  }
}
```

### 6.3 Helper API 端点

Helper 通过 Unix Socket (`/tmp/sparkle-helper.sock`) 提供以下 HTTP API：

- `POST /proxy` - 设置手动代理
- `POST /pac` - 设置 PAC 代理
- `POST /disable` - 禁用代理
- `GET /ping` - 检查 Helper 是否运行

## 7. 完整流程图

```
用户开启系统代理
    ↓
triggerSysProxy(enable, onlyActiveDevice)
    ↓
检查网络状态 (net.isOnline())
    ↓
├─ 网络未连接 → 延迟 5 秒重试
└─ 网络已连接
    ↓
setSysProxy(onlyActiveDevice)
    ↓
├─ 设置平台默认绕过列表
├─ 启动 PAC 服务器（如果 mode === 'auto'）
└─ 根据模式和平台设置代理
    ↓
├─ PAC 模式 (auto)
│   ├─ macOS → axios.post('http://localhost/pac', {...}, {socketPath: helperSocketPath})
│   ├─ Windows → sysproxy pac --url <url>
│   └─ Linux → sysproxy pac --url <url>
│
└─ 手动模式 (manual)
    ├─ macOS → axios.post('http://localhost/proxy', {...}, {socketPath: helperSocketPath})
    ├─ Windows → sysproxy proxy --server <server> --bypass <bypass>
    └─ Linux → sysproxy proxy --server <server> --bypass <bypass>
```

## 8. 关键配置项

```typescript
interface ISysProxyConfig {
  enable: boolean              // 是否启用
  host?: string                // 代理主机（默认：127.0.0.1）
  mode?: 'auto' | 'manual'     // 代理模式
  bypass?: string[]            // 绕过列表
  pacScript?: string           // PAC 脚本（仅 PAC 模式）
}
```

## 9. 关键代码位置

| 功能 | 文件 | 关键函数 |
|------|------|----------|
| 代理开关触发 | `src/main/sys/sysproxy.ts` | `triggerSysProxy` |
| 设置代理 | `src/main/sys/sysproxy.ts` | `setSysProxy` |
| 禁用代理 | `src/main/sys/sysproxy.ts` | `disableSysProxy` |
| PAC 服务器 | `src/main/resolve/server.ts` | `startPacServer` |
| Helper 安装 | `src/main/sys/sysproxy.ts` | `installHelper` |
| Helper 检查 | `src/main/sys/sysproxy.ts` | `isHelperInstalled` |
| sysproxy 路径 | `src/main/utils/dirs.ts` | `sysproxyPath` |

## 10. 总结

全局代理实现要点：

1. **使用 `sysproxy` 程序**调用系统 API 设置代理
2. **PAC 模式**：本地 HTTP 服务器提供 PAC 脚本
3. **手动模式**：直接设置代理服务器地址和端口
4. **平台差异**：绕过列表分隔符、设置方式不同
5. **macOS Helper**：通过系统服务避免每次授权，使用 Unix Socket 提供 HTTP API

该实现通过修改系统代理设置，让系统流量走 mihomo 内核的混合端口（默认 7890），实现全局代理。
