#!/bin/bash

# 修复已损坏脚本 - 移除 macOS Gatekeeper 隔离属性

APP_PATH="/Applications/CrowVPN.app"

# 检查应用是否已安装
if [ ! -d "$APP_PATH" ]; then
    osascript -e 'display dialog "未找到 CrowVPN 应用\n\n请先安装 CrowVPN.app 到 /Applications 目录" buttons {"确定"} default button 1 with icon caution with title "修复 CrowVPN"'
    exit 1
fi

# 使用 osascript 请求管理员权限并执行修复
osascript -e "
    do shell script \"xattr -rd com.apple.quarantine '$APP_PATH'\" with administrator privileges
" 2>&1

# 检查执行结果
if [ $? -eq 0 ]; then
    osascript -e 'display dialog "✅ 修复成功！\n\n现在可以正常打开 CrowVPN 了" buttons {"确定"} default button 1 with icon note with title "修复 CrowVPN"'
else
    osascript -e 'display dialog "❌ 修复失败\n\n可能是权限问题或应用未正确安装" buttons {"确定"} default button 1 with icon stop with title "修复 CrowVPN"'
    exit 1
fi
