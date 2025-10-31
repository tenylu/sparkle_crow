import { copyFileSync, chmodSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'

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
}

