# 虚拟网卡（TUN）测试指南

## 快速测试方法

### 方法 1：使用测试脚本（推荐）

运行测试脚本：
```bash
./scripts/test-tun.sh
```

脚本会自动检查：
- TUN 网络接口
- 路由表
- DNS 设置
- Mihomo 进程状态
- 网络连接
- 配置文件

### 方法 2：手动检查

#### 1. 检查 TUN 网络接口

```bash
# 查看所有网络接口
ifconfig | grep utun

# 应该看到类似这样的输出：
# utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1500
```

如果看到 `utun*` 接口，说明 TUN 已创建。

#### 2. 检查路由表

```bash
# 查看默认路由
netstat -rn | grep default

# 查看所有路由
netstat -rn | grep utun
```

如果 TUN 正常工作，应该看到通过 `utun*` 接口的路由。

#### 3. 检查 DNS 设置

```bash
# 查看 DNS 配置
scutil --dns | grep nameserver

# 或者
networksetup -getdnsservers Wi-Fi
```

TUN 启用时，DNS 通常会被设置为 `127.0.0.1` 或 `::1`。

#### 4. 检查 Mihomo 配置

```bash
# 通过 API 检查配置
curl --unix-socket /tmp/sparkle-mihomo-api.sock http://localhost/configs | grep -A 10 '"tun"'

# 或者直接查看配置文件
cat ~/Library/Application\ Support/crowvpn/mihomo.yaml | grep -A 10 "^tun:"
```

应该看到 `enable: true`。

#### 5. 测试网络连接

```bash
# 测试 IP 地址
curl http://ip-api.com/json

# 测试 DNS 解析
nslookup google.com

# 测试 HTTPS 连接
curl -I https://www.google.com
```

如果 TUN 正常工作，所有流量都会通过代理节点。

#### 6. 检查 Mihomo 连接状态

```bash
# 查看实时连接
curl --unix-socket /tmp/sparkle-mihomo-api.sock http://localhost/connections

# 查看代理组
curl --unix-socket /tmp/sparkle-mihomo-api.sock http://localhost/proxies
```

#### 7. 检查系统日志

```bash
# 查看应用日志
tail -f ~/Library/Application\ Support/crowvpn/logs/*.log

# 查看系统日志（TUN 相关）
log show --predicate 'process == "mihomo"' --last 10m | grep -i tun
```

## 验证 TUN 是否真正工作

### 测试 1：检查所有流量是否走代理

1. **查看连接信息**：
   ```bash
   curl --unix-socket /tmp/sparkle-mihomo-api.sock http://localhost/connections
   ```
   
   应该看到所有连接都通过代理节点。

2. **测试 IP 地址**：
   ```bash
   curl http://ip-api.com/json
   ```
   
   应该返回代理节点的 IP 地址，而不是本地 IP。

### 测试 2：检查 DNS 劫持

```bash
# 查看 DNS 配置
scutil --dns | grep "nameserver\[0\]"

# 应该看到类似：
# nameserver[0] : 127.0.0.1
```

### 测试 3：检查路由规则

```bash
# 查看路由表
netstat -rn | head -20

# 应该看到通过 utun 接口的路由
```

## 常见问题排查

### 问题 1：未找到 TUN 接口

**可能原因**：
- 权限未正确设置（SUID 位未设置）
- Mihomo 启动失败
- TUN 配置错误

**解决方法**：
1. 检查权限：
   ```bash
   ls -l /Applications/CrowVPN.app/Contents/Resources/sidecar/mihomo
   ```
   应该看到 `-rwsr-xr-x`（`s` 表示 SUID 位）

2. 检查 Mihomo 日志：
   ```bash
   tail -50 ~/Library/Application\ Support/crowvpn/logs/*.log | grep -i "tun\|error"
   ```

3. 手动设置权限：
   ```bash
   sudo chmod +sx /Applications/CrowVPN.app/Contents/Resources/sidecar/mihomo
   ```

### 问题 2：TUN 接口存在但流量不走代理

**可能原因**：
- 路由规则未正确设置
- DNS 未正确配置
- 代理节点未连接

**解决方法**：
1. 检查路由：
   ```bash
   netstat -rn | grep utun
   ```

2. 检查 DNS：
   ```bash
   scutil --dns
   ```

3. 重启应用或重新连接节点

### 问题 3：权限设置失败

**可能原因**：
- macOS SIP 限制
- 文件被隔离（quarantine）
- 安装脚本未正确执行

**解决方法**：
1. 移除隔离属性：
   ```bash
   sudo xattr -d com.apple.quarantine /Applications/CrowVPN.app/Contents/Resources/sidecar/mihomo
   ```

2. 手动设置权限：
   ```bash
   sudo chmod +sx /Applications/CrowVPN.app/Contents/Resources/sidecar/mihomo
   ```

3. 验证权限：
   ```bash
   ls -l /Applications/CrowVPN.app/Contents/Resources/sidecar/mihomo
   ```

## 成功标志

如果以下条件都满足，说明 TUN 已成功开启：

✅ 存在 `utun*` 网络接口  
✅ 路由表包含通过 `utun*` 的路由  
✅ DNS 设置为 `127.0.0.1` 或 `::1`  
✅ Mihomo 配置中 `tun.enable: true`  
✅ 所有网络流量通过代理节点  
✅ 应用界面显示"系统接管（所有程序走代理）"为已开启状态  

## 注意事项

1. **权限要求**：TUN 需要 SUID 权限，可能需要管理员密码
2. **SIP 限制**：macOS 系统完整性保护可能阻止权限设置
3. **开发环境**：在开发环境中（用户目录），TUN 可能无法正常工作
4. **系统代理**：启用 TUN 时，系统代理通常会被禁用（TUN 接管所有流量）

