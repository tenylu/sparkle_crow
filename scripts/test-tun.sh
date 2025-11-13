#!/bin/bash

# 测试虚拟网卡（TUN）是否成功开启的脚本

echo "========================================="
echo "虚拟网卡（TUN）状态检查"
echo "========================================="
echo ""

# 1. 检查 TUN 网络接口
echo "1. 检查 TUN 网络接口："
echo "----------------------------------------"
TUN_INTERFACES=$(ifconfig | grep -E "^utun[0-9]+" | awk '{print $1}' | sed 's/://')
if [ -z "$TUN_INTERFACES" ]; then
    echo "❌ 未找到 TUN 接口（utun*）"
else
    echo "✅ 找到以下 TUN 接口："
    echo "$TUN_INTERFACES" | while read -r iface; do
        echo "  - $iface"
        ifconfig "$iface" | grep -E "inet |status:" | head -2
    done
fi
echo ""

# 2. 检查路由表
echo "2. 检查路由表（TUN 相关）："
echo "----------------------------------------"
ROUTES=$(netstat -rn | grep -E "utun|default" | head -10)
if [ -z "$ROUTES" ]; then
    echo "⚠️  未找到相关路由"
else
    echo "$ROUTES"
fi
echo ""

# 3. 检查 DNS 设置
echo "3. 检查 DNS 设置："
echo "----------------------------------------"
DNS_SERVERS=$(scutil --dns | grep "nameserver\[" | head -5)
if [ -z "$DNS_SERVERS" ]; then
    echo "⚠️  未找到 DNS 服务器配置"
else
    echo "$DNS_SERVERS"
fi
echo ""

# 4. 检查 Mihomo 进程和配置
echo "4. 检查 Mihomo 进程："
echo "----------------------------------------"
MIHOMO_PID=$(pgrep -f "mihomo|clash" | head -1)
if [ -z "$MIHOMO_PID" ]; then
    echo "❌ Mihomo 进程未运行"
else
    echo "✅ Mihomo 进程运行中 (PID: $MIHOMO_PID)"
    echo "   进程详情："
    ps -p "$MIHOMO_PID" -o pid,user,command 2>/dev/null | tail -1 || echo "   无法获取进程详情"
fi
echo ""

# 5. 检查 Mihomo API 连接
echo "5. 检查 Mihomo API 连接："
echo "----------------------------------------"
API_SOCK="/tmp/sparkle-mihomo-api.sock"
if [ -S "$API_SOCK" ]; then
    echo "✅ API Socket 存在: $API_SOCK"
    # 尝试获取配置信息
    CONFIG=$(curl --unix-socket "$API_SOCK" http://localhost/configs 2>/dev/null)
    if [ -n "$CONFIG" ]; then
        TUN_ENABLED=$(echo "$CONFIG" | grep -o '"tun":{[^}]*"enable":[^,}]*' | grep -o '"enable":true')
        if [ -n "$TUN_ENABLED" ]; then
            echo "✅ TUN 在配置中已启用"
        else
            echo "❌ TUN 在配置中未启用"
        fi
    fi
else
    echo "❌ API Socket 不存在"
fi
echo ""

# 6. 测试网络连接
echo "6. 测试网络连接："
echo "----------------------------------------"
echo "测试 IP 地址（通过 TUN）："
# 尝试多个 IP 查询服务
IP_SERVICES=("http://ip-api.com/json" "https://api.ipify.org?format=json" "http://ifconfig.me/all.json")
IP_FOUND=false

for service in "${IP_SERVICES[@]}"; do
    IP_RESULT=$(curl -s --max-time 5 "$service" 2>/dev/null)
    if [ -n "$IP_RESULT" ]; then
        # 尝试提取 IP
        IP=$(echo "$IP_RESULT" | grep -oE '"ip":"[^"]*"|"query":"[^"]*"|"ip":"[^"]*"' | head -1 | cut -d'"' -f4)
        if [ -z "$IP" ]; then
            IP=$(echo "$IP_RESULT" | grep -oE '[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}' | head -1)
        fi
        if [ -n "$IP" ]; then
            echo "  ✅ 当前 IP: $IP"
            IP_FOUND=true
            # 尝试获取地理位置
            COUNTRY=$(echo "$IP_RESULT" | grep -o '"country":"[^"]*' | head -1 | cut -d'"' -f4)
            if [ -n "$COUNTRY" ]; then
                echo "  📍 地理位置: $COUNTRY"
            fi
            break
        fi
    fi
done

if [ "$IP_FOUND" = false ]; then
    echo "  ⚠️  无法获取 IP 地址（可能是网络问题或代理节点未连接）"
    echo "  💡 提示：检查代理节点是否已连接"
fi
echo ""

# 7. 检查系统日志
echo "7. 检查最近的系统日志（TUN 相关）："
echo "----------------------------------------"
LOG_ENTRIES=$(log show --predicate 'process == "mihomo" OR process == "CrowVPN"' --last 5m 2>/dev/null | grep -i "tun\|virtual\|network" | head -5)
if [ -n "$LOG_ENTRIES" ]; then
    echo "$LOG_ENTRIES"
else
    echo "⚠️  未找到相关日志"
fi
echo ""

# 8. 检查应用配置
echo "8. 检查应用配置："
echo "----------------------------------------"
CONFIG_FILE="$HOME/Library/Application Support/crowvpn/mihomo.yaml"
if [ -f "$CONFIG_FILE" ]; then
    echo "✅ 配置文件存在: $CONFIG_FILE"
    TUN_CONFIG=$(grep -A 5 "^tun:" "$CONFIG_FILE" | head -6)
    if [ -n "$TUN_CONFIG" ]; then
        echo "TUN 配置："
        echo "$TUN_CONFIG"
        if echo "$TUN_CONFIG" | grep -q "enable: true"; then
            echo "✅ TUN 在配置文件中已启用"
        else
            echo "❌ TUN 在配置文件中未启用"
        fi
    else
        echo "⚠️  未找到 TUN 配置"
    fi
else
    echo "❌ 配置文件不存在"
fi
echo ""

# 9. 总结状态
echo "9. 状态总结："
echo "----------------------------------------"
TUN_ENABLED=false
TUN_INTERFACE_EXISTS=false
ROUTES_EXIST=false
DNS_CORRECT=false

# 检查 TUN 接口
if [ -n "$TUN_INTERFACES" ]; then
    TUN_INTERFACE_EXISTS=true
fi

# 检查路由
if echo "$ROUTES" | grep -q "utun"; then
    ROUTES_EXIST=true
fi

# 检查 DNS
if echo "$DNS_SERVERS" | grep -q "10.251.1.1\|198.18.0.1"; then
    DNS_CORRECT=true
fi

# 检查配置
if [ -f "$CONFIG_FILE" ] && grep -q "enable: true" "$CONFIG_FILE" 2>/dev/null; then
    TUN_ENABLED=true
fi

echo ""
echo "========================================="
echo "测试完成 - 状态总结"
echo "========================================="
echo ""
if [ "$TUN_INTERFACE_EXISTS" = true ] && [ "$TUN_ENABLED" = true ] && [ "$ROUTES_EXIST" = true ]; then
    echo "✅ 虚拟网卡（TUN）已成功开启！"
    echo ""
    echo "验证结果："
    [ "$TUN_INTERFACE_EXISTS" = true ] && echo "  ✅ TUN 接口已创建"
    [ "$TUN_ENABLED" = true ] && echo "  ✅ TUN 配置已启用"
    [ "$ROUTES_EXIST" = true ] && echo "  ✅ 路由规则已设置"
    [ "$DNS_CORRECT" = true ] && echo "  ✅ DNS 配置正确" || echo "  ⚠️  DNS 配置可能需要检查"
    echo ""
    echo "💡 提示："
    echo "- 所有网络流量现在应该通过代理节点"
    echo "- 如果无法访问某些网站，请检查代理节点状态"
    echo "- 可以通过应用界面查看连接状态和流量统计"
else
    echo "⚠️  虚拟网卡可能未完全启用"
    echo ""
    echo "检查结果："
    [ "$TUN_INTERFACE_EXISTS" = true ] && echo "  ✅ TUN 接口已创建" || echo "  ❌ TUN 接口未创建"
    [ "$TUN_ENABLED" = true ] && echo "  ✅ TUN 配置已启用" || echo "  ❌ TUN 配置未启用"
    [ "$ROUTES_EXIST" = true ] && echo "  ✅ 路由规则已设置" || echo "  ❌ 路由规则未设置"
    echo ""
    echo "💡 建议："
    echo "- 检查应用界面中的 TUN 开关是否已开启"
    echo "- 检查权限设置：ls -l /Applications/CrowVPN.app/Contents/Resources/sidecar/mihomo"
    echo "- 查看应用日志：tail -f ~/Library/Application\\ Support/crowvpn/logs/*.log"
fi
echo ""

