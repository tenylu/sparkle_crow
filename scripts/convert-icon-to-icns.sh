#!/bin/bash

# 转换 PNG 图片为 .icns 格式
# 使用方法: ./scripts/convert-icon-to-icns.sh <input.png> <output.icns>

if [ $# -lt 1 ]; then
    echo "使用方法: $0 <input.png> [output.icns]"
    echo "示例: $0 icon.png crowvpn.icns"
    echo ""
    echo "如果只提供输入文件，输出文件名将自动生成"
    exit 1
fi

INPUT="$1"
OUTPUT="${2:-build/crowvpn.icns}"

# 如果输出路径不包含目录，默认放到 build 目录
if [[ "$OUTPUT" != */* ]]; then
    OUTPUT="build/$OUTPUT"
fi

# 确保输出文件名以 .icns 结尾
if [[ "$OUTPUT" != *.icns ]]; then
    OUTPUT="${OUTPUT}.icns"
fi

if [ ! -f "$INPUT" ]; then
    echo "错误: 找不到输入文件: $INPUT"
    exit 1
fi

# 确保 build 目录存在
mkdir -p "$(dirname "$OUTPUT")"

# 创建临时目录用于生成 iconset
ICONSET="${OUTPUT%.icns}.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

echo "正在转换 $INPUT -> $OUTPUT ..."

# 生成各种尺寸的图标 (macOS 需要的所有尺寸)
sips -z 16 16     "$INPUT" --out "$ICONSET/icon_16x16.png" > /dev/null 2>&1
sips -z 32 32     "$INPUT" --out "$ICONSET/icon_16x16@2x.png" > /dev/null 2>&1
sips -z 32 32     "$INPUT" --out "$ICONSET/icon_32x32.png" > /dev/null 2>&1
sips -z 64 64     "$INPUT" --out "$ICONSET/icon_32x32@2x.png" > /dev/null 2>&1
sips -z 128 128   "$INPUT" --out "$ICONSET/icon_128x128.png" > /dev/null 2>&1
sips -z 256 256   "$INPUT" --out "$ICONSET/icon_128x128@2x.png" > /dev/null 2>&1
sips -z 256 256   "$INPUT" --out "$ICONSET/icon_256x256.png" > /dev/null 2>&1
sips -z 512 512   "$INPUT" --out "$ICONSET/icon_256x256@2x.png" > /dev/null 2>&1
sips -z 512 512   "$INPUT" --out "$ICONSET/icon_512x512.png" > /dev/null 2>&1
sips -z 1024 1024 "$INPUT" --out "$ICONSET/icon_512x512@2x.png" > /dev/null 2>&1

# 转换为 .icns
iconutil -c icns "$ICONSET" -o "$OUTPUT"

# 清理临时目录
rm -rf "$ICONSET"

if [ -f "$OUTPUT" ]; then
    echo "✓ 成功生成: $OUTPUT"
    echo "文件大小: $(ls -lh "$OUTPUT" | awk '{print $5}')"
else
    echo "✗ 转换失败"
    exit 1
fi
