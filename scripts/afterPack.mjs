import { copyFileSync, chmodSync, mkdirSync, existsSync, readdirSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default async function afterPack(context) {
  // 只在 macOS 构建时执行
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  // appOutDir 是打包后的 .app 目录
  // 需要找到 dist 目录（DMG 的根目录）
  const { appOutDir } = context
  // 获取 dist 目录（appOutDir 的父目录，包含 DMG 内容）
  const distDir = dirname(dirname(appOutDir))
  
  // 复制修复脚本到 dist 目录（DMG 根目录）
  const fixScript = join(__dirname, '..', 'build', '修复已损坏.command')
  const targetScript = join(distDir, '修复已损坏.command')
  
  try {
    // 确保目录存在
    if (!existsSync(distDir)) {
      mkdirSync(distDir, { recursive: true })
    }
    
    copyFileSync(fixScript, targetScript)
    chmodSync(targetScript, 0o755)
    console.log('✅ 已添加修复脚本到 DMG 目录:', targetScript)
  } catch (error) {
    console.error('❌ 复制修复脚本失败:', error)
  }

  // 设置 .pkg 文件的图标
  try {
    const iconPath = join(__dirname, '..', 'build', 'crowvpn.icns')
    if (!existsSync(iconPath)) {
      console.warn('⚠️  图标文件不存在:', iconPath)
      return
    }

    // 查找 dist 目录下的 .pkg 文件
    const files = readdirSync(distDir)
    const pkgFiles = files.filter(file => extname(file) === '.pkg')

    if (pkgFiles.length === 0) {
      console.warn('⚠️  未找到 .pkg 文件')
      return
    }

    // 为每个 .pkg 文件设置图标
    for (const pkgFile of pkgFiles) {
      const pkgPath = join(distDir, pkgFile)
      try {
        // 使用 AppleScript 设置文件图标
        // 将 AppleScript 写入临时文件，避免命令行转义问题
        const tempScript = join(tmpdir(), `seticon-${Date.now()}.scpt`)
        const appleScript = `tell application "Finder"
          set theFile to POSIX file "${pkgPath}" as alias
          set theIcon to POSIX file "${iconPath}" as alias
          set icon of theFile to theIcon
        end tell`
        
        writeFileSync(tempScript, appleScript)
        
        try {
          execSync(`osascript "${tempScript}"`, { stdio: 'inherit' })
          console.log(`✅ 已设置 ${pkgFile} 的图标`)
        } finally {
          // 清理临时文件
          try {
            unlinkSync(tempScript)
          } catch (e) {
            // 忽略清理错误
          }
        }
      } catch (error) {
        console.warn(`⚠️  无法设置 ${pkgFile} 的图标:`, error.message)
      }
    }
  } catch (error) {
    console.error('❌ 设置 .pkg 图标失败:', error)
  }
}

