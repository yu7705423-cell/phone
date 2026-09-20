#!/usr/bin/env bash
# 打一个未签名的 ipa。只能在装了 Xcode 命令行工具的 macOS 上跑。
#
# 不用 Xcode 工程：这只 app 就三个 Swift 文件加一份 Info.plist，
# swiftc 直接编出可执行文件，再按 Payload/Phone.app 的目录结构摆好压成 zip 即可。
# 一份 pbxproj 要多维护几百行，还看不出改了什么。
#
#   APP_URL=https://example.com/ ios/build.sh
#
# 环境变量（都有默认值）：
#   APP_URL       网页地址。写进 Info.plist 的 PhoneSiteURL
#   BUNDLE_ID     包标识
#   DISPLAY_NAME  主屏幕上显示的名字
#   VERSION       版本号
#   BUILD_NUM     构建号
#   MIN_IOS       最低系统版本
#   APP_BOUND     置 0 则不写 WKAppBoundDomains
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

APP_URL="${APP_URL:-https://yu7705423-cell.github.io/phone/}"
BUNDLE_ID="${BUNDLE_ID:-com.example.xiaoshouji}"
DISPLAY_NAME="${DISPLAY_NAME:-小手机}"
VERSION="${VERSION:-1.0.0}"
BUILD_NUM="${BUILD_NUM:-1}"
MIN_IOS="${MIN_IOS:-15.0}"
APP_BOUND="${APP_BOUND:-1}"

command -v xcrun >/dev/null || { echo "需要 Xcode 命令行工具，请在 macOS 上运行"; exit 1; }

OUT="$HERE/build"
APP="$OUT/Payload/Phone.app"
rm -rf "$OUT"
mkdir -p "$APP"

echo "站点地址  $APP_URL"
echo "包标识    $BUNDLE_ID"
echo "版本      $VERSION ($BUILD_NUM)，最低 iOS $MIN_IOS"

# ---- 1. 编可执行文件 ----
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
# AlarmKit（系统闹钟）要 iOS 26 的 SDK。这套 SDK 里没有的话 AlarmBridge.swift
# 那段 #if canImport 整个不编，app 照常能装，只是「系统闹钟」那一项写着不可用。
# 在日志里说一声，免得回头查「为什么排不了闹钟」时无从下手。
if [ -d "$SDK/System/Library/Frameworks/AlarmKit.framework" ] \
   || [ -f "$SDK/usr/lib/swift/AlarmKit.swiftmodule" ] \
   || ls "$SDK"/usr/lib/swift/*/AlarmKit* >/dev/null 2>&1; then
  echo "AlarmKit   在这套 SDK 里，系统闹钟可用"
else
  echo "AlarmKit   这套 SDK 里没有（需要 iOS 26 SDK / Xcode 26），系统闹钟不可用"
fi
xcrun -sdk iphoneos swiftc \
  -target "arm64-apple-ios$MIN_IOS" \
  -sdk "$SDK" \
  -swift-version 5 \
  -O -parse-as-library \
  -o "$APP/Phone" \
  "$HERE"/Sources/*.swift
echo "已编译    $(du -h "$APP/Phone" | cut -f1)"

# ---- 2. Info.plist ----
PB=/usr/libexec/PlistBuddy
cp "$HERE/Info.plist" "$APP/Info.plist"
$PB -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP/Info.plist"
$PB -c "Set :CFBundleDisplayName $DISPLAY_NAME" "$APP/Info.plist"
$PB -c "Set :CFBundleShortVersionString $VERSION" "$APP/Info.plist"
$PB -c "Set :CFBundleVersion $BUILD_NUM" "$APP/Info.plist"
$PB -c "Set :MinimumOSVersion $MIN_IOS" "$APP/Info.plist"
$PB -c "Set :PhoneSiteURL $APP_URL" "$APP/Info.plist"

HOST="$(python3 -c 'import sys,urllib.parse as u; print(u.urlparse(sys.argv[1]).hostname or "")' "$APP_URL")"
$PB -c "Delete :WKAppBoundDomains" "$APP/Info.plist" >/dev/null 2>&1 || true
$PB -c "Add :WKAppBoundDomains array" "$APP/Info.plist"
if [ "$APP_BOUND" = "1" ] && [ -n "$HOST" ]; then
  $PB -c "Add :WKAppBoundDomains:0 string $HOST" "$APP/Info.plist"
  echo "数据保护  已登记 $HOST"
else
  echo "数据保护  未登记。系统可能在长期未打开后清除本机数据"
fi
plutil -convert binary1 "$APP/Info.plist"

# ---- 3. 图标 ----
# 源图是 512 的不透明 PNG，缩一遍就够，不需要资源目录（asset catalog）
SRC="$ROOT/icon-512.png"
icon() { sips -s format png -z "$2" "$2" "$SRC" --out "$APP/$1" >/dev/null; }
icon AppIcon29x29@2x.png 58
icon AppIcon29x29@3x.png 87
icon AppIcon40x40@2x.png 80
icon AppIcon40x40@3x.png 120
icon AppIcon60x60@2x.png 120
icon AppIcon60x60@3x.png 180
icon AppIcon76x76@2x.png 152
icon AppIcon83.5x83.5@2x.png 167
echo "已生成    8 个图标"

# ---- 4. 压成 ipa ----
# 用 ad-hoc 签名把 entitlements 写进包里（`-s -` 不需要任何证书）。
# 真正的签名仍然由用户自己在 AltStore、Sideloadly 或 TrollStore 里做 ——
# 这一步只是把「这只 app 要读健康数据」这个声明放进去，
# 重签的工具会照着它决定带不带得上那个权限。带不上也不影响其余功能。
if codesign --force --sign - --entitlements "$HERE/Phone.entitlements" \
  --timestamp=none "$APP" >/dev/null 2>&1; then
  # 光签成不算数，要确认那几条真的写进去了 —— 签完不看等于没签
  if codesign -d --entitlements - --xml "$APP" 2>/dev/null | grep -q 'healthkit'; then
    echo "权限声明  已写入（healthkit）。能不能真拿到取决于重签时用的账号"
  else
    echo "权限声明  没写进去。健康同步在这个包里用不了，其余功能不受影响"
  fi
else
  echo "权限声明  临时签名没成，改为不签名交出去。健康同步用不了，其余不受影响"
  codesign --remove-signature "$APP" >/dev/null 2>&1 || true
fi
IPA="$OUT/phone-unsigned-$VERSION.ipa"
( cd "$OUT" && zip -qry "$(basename "$IPA")" Payload )
echo
echo "完成      $IPA  ($(du -h "$IPA" | cut -f1))"
