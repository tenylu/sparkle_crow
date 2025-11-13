import axios, { AxiosError, AxiosRequestConfig, CancelTokenSource } from 'axios'
import { parseYaml } from '../utils/yaml'
import { app, shell, dialog } from 'electron'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { dataDir, exeDir, exePath, isPortable, resourcesFilesDir } from '../utils/dirs'
import { copyFile, rm, writeFile, readFile, chmod } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { setNotQuitDialog, mainWindow } from '..'
import { disableSysProxy } from '../sys/sysproxy'

let downloadCancelToken: CancelTokenSource | null = null

export async function checkUpdate(): Promise<AppVersion | undefined> {
  try {
    const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
    const { updateChannel = 'stable' } = await getAppConfig()
    
    // Cloudflare R2 URL
    const baseUrl = 'https://cloud.crowmesh.com'
    let url = `${baseUrl}/latest.yml`
    if (updateChannel == 'beta') {
      url = `${baseUrl}/latest-beta.yml`
    }
    
    console.log('[AutoUpdater] Checking for updates from:', url)
    
    const manifestText = await fetchUpdateManifest(url, mixedPort !== 0 ? mixedPort : null)
    if (!manifestText) {
      return undefined
    }

    // Parse YAML
    let latestVersionInfo: AppVersion
    try {
      latestVersionInfo = parseYaml<AppVersion>(manifestText)
      console.log('[AutoUpdater] Parsed update info:', latestVersionInfo)
    } catch (parseError) {
      console.error('[AutoUpdater] Failed to parse update info YAML:', parseError)
      return undefined
    }
    
    // Validate version format
    if (!latestVersionInfo || !latestVersionInfo.version || typeof latestVersionInfo.version !== 'string') {
      console.error('[AutoUpdater] Invalid update info format:', latestVersionInfo)
      return undefined
    }
    
    const currentVersion = app.getVersion()
    
    // Parse version strings (e.g., "2.0.4" -> [2, 0, 4], "2.0.3-beta" -> [2, 0, 3])
    // Remove any suffix like -beta, -alpha, etc.
    const parseVersion = (version: string): number[] => {
      // Remove suffix like -beta, -alpha, -rc1, etc.
      const cleanVersion = version.split('-')[0].trim()
      const parts = cleanVersion.split('.').map(Number)
      // Filter out NaN values and ensure all parts are valid numbers
      return parts.filter(part => !isNaN(part) && part >= 0)
    }
    
    const currentParts = parseVersion(currentVersion)
    const latestParts = parseVersion(latestVersionInfo.version)
    
    // Get clean version strings for logging
    const currentCleanVersion = currentVersion.split('-')[0].trim()
    const latestCleanVersion = latestVersionInfo.version.split('-')[0].trim()
    
    console.log('[AutoUpdater] Current version:', currentVersion, '(', currentCleanVersion, ')')
    console.log('[AutoUpdater] Latest version:', latestVersionInfo.version, '(', latestCleanVersion, ')')
    console.log('[AutoUpdater] Version parts - current:', currentParts, 'latest:', latestParts)
    
    // Validate parsed versions
    if (currentParts.length === 0 || latestParts.length === 0) {
      console.error('[AutoUpdater] Invalid version format after parsing - current:', currentParts, 'latest:', latestParts)
      return undefined
    }
    
    // Compare versions using semver-like logic
    // Only return update if latest version is newer than current version
    if (currentCleanVersion === latestCleanVersion) {
      console.log('[AutoUpdater] Versions are equal, no update needed')
      return undefined
    }
    
    // Compare version arrays
    const maxLength = Math.max(currentParts.length, latestParts.length)
    for (let i = 0; i < maxLength; i++) {
      const currentPart = currentParts[i] || 0
      const latestPart = latestParts[i] || 0
      
      console.log(`[AutoUpdater] Comparing part ${i}: current=${currentPart}, latest=${latestPart}`)
      
      if (latestPart > currentPart) {
        // Latest version is newer, return update info
        console.log('[AutoUpdater] Update available:', latestVersionInfo.version, '(latest is newer)')
        return latestVersionInfo
      } else if (latestPart < currentPart) {
        // Latest version is older, don't update
        console.log('[AutoUpdater] Latest version is older, no update')
        return undefined
      }
      // If equal, continue to next part
    }
    
    // Versions are equal (shouldn't happen due to first check, but just in case)
    console.log('[AutoUpdater] Versions are equal after comparison')
    return undefined
  } catch (error: any) {
    console.error('[AutoUpdater] Error checking for updates:', error.message)
    return undefined
  }
}

async function fetchUpdateManifest(url: string, proxyPort: number | null): Promise<string | undefined> {
  const config: AxiosRequestConfig = {
    headers: { 'Content-Type': 'application/octet-stream' },
    validateStatus: () => true,
    responseType: 'text',
    timeout: 10000
  }

  if (proxyPort && proxyPort > 0) {
    config.proxy = {
      protocol: 'http',
      host: '127.0.0.1',
      port: proxyPort
    }
  } else {
    config.proxy = false
  }

  try {
    const res = await axios.get(url, config)
    if (res.status !== 200 || !res.data) {
      console.error(
        `[AutoUpdater] Failed to fetch update info${proxyPort && proxyPort > 0 ? ' via proxy' : ''}:`,
        res.status,
        res.statusText
      )
      if (proxyPort && proxyPort > 0) {
        console.warn('[AutoUpdater] Retrying update check without proxy')
        return fetchUpdateManifest(url, null)
      }
      return undefined
    }
    return typeof res.data === 'string' ? res.data : String(res.data)
  } catch (error: unknown) {
    if (proxyPort && proxyPort > 0 && isLocalProxyConnectionError(error, proxyPort)) {
      const message = (error as Error).message ?? ''
      console.warn(
        `[AutoUpdater] Proxy 127.0.0.1:${proxyPort} unavailable for update check (${message}), retrying without proxy`
      )
      return fetchUpdateManifest(url, null)
    }
    throw error
  }
}

const LOCAL_PROXY_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'])

function isLocalProxyConnectionError(error: unknown, proxyPort: number): boolean {
  if (!axios.isAxiosError(error)) {
    return false
  }

  const axiosError = error as AxiosError
  const code = axiosError.code ?? ''
  if (LOCAL_PROXY_ERROR_CODES.has(code)) {
    return true
  }

  const message = axiosError.message ?? ''
  if (message.includes('127.0.0.1') || message.includes('localhost') || message.includes(`:${proxyPort}`)) {
    return true
  }

  const causeMessage =
    axiosError.cause instanceof Error ? axiosError.cause.message ?? '' : typeof axiosError.cause === 'string' ? axiosError.cause : ''

  if (typeof causeMessage === 'string' && causeMessage.length > 0) {
    return causeMessage.includes('127.0.0.1') || causeMessage.includes('localhost') || causeMessage.includes(`:${proxyPort}`)
  }

  return false
}

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  
  // Cloudflare R2 URL - use same base URL as checkUpdate
  const baseUrl = 'https://cloud.crowmesh.com'
  const fileMap = {
    'win32-x64': `crowvpn-windows-${version}-x64-setup.exe`,
    'win32-arm64': `crowvpn-windows-${version}-arm64-setup.exe`,
    'darwin-x64': `crowvpn-macos-${version}-x64.pkg`,
    'darwin-arm64': `crowvpn-macos-${version}-arm64.pkg`
  }
  let file = fileMap[`${process.platform}-${process.arch}`]
  if (isPortable()) {
    file = file.replace('-setup.exe', '-portable.7z')
  }
  if (!file) {
    throw new Error('不支持自动更新，请手动下载更新')
  }
  downloadCancelToken = axios.CancelToken.source()

  // Read hash from R2 metadata file
  const hashUrl = `${baseUrl}/${file}.sha256`
  const hashRequestConfig: AxiosRequestConfig = {
    ...(mixedPort != 0 && {
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port: mixedPort
      }
    }),
    validateStatus: () => true,
    responseType: 'text'
  }

  try {
    mainWindow?.webContents.send('update-status', {
      downloading: true,
      progress: 0
    })

    const hashRes = await axios.get(hashUrl, hashRequestConfig)
    const expectedHash = hashRes.data.trim().split(/\s+/)[0].toLowerCase()

    if (!existsSync(path.join(dataDir(), file))) {
      const res = await axios.get(`${baseUrl}/${file}`, {
        responseType: 'arraybuffer',
        ...(mixedPort != 0 && {
          proxy: {
            protocol: 'http',
            host: '127.0.0.1',
            port: mixedPort
          }
        }),
        validateStatus: () => true,
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        cancelToken: downloadCancelToken.token,
        onDownloadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / (progressEvent.total || 1)
          )
          mainWindow?.webContents.send('update-status', {
            downloading: true,
            progress: percentCompleted
          })
        }
      })
      await writeFile(path.join(dataDir(), file), res.data)
    }

    const fileBuffer = await readFile(path.join(dataDir(), file))
    const hashSum = createHash('sha256')
    hashSum.update(fileBuffer)
    const localHash = hashSum.digest('hex').toLowerCase()
    if (localHash !== expectedHash) {
      await rm(path.join(dataDir(), file), { force: true })
      throw new Error(`SHA-256 校验失败：本地哈希 ${localHash} 与预期 ${expectedHash} 不符`)
    }

    mainWindow?.webContents.send('update-status', {
      downloading: false,
      progress: 100
    })

    // Send installing status before starting installer
    mainWindow?.webContents.send('update-status', {
      downloading: true, // Using downloading flag for installing state
      progress: 0 // Progress 0 indicates installing phase
    })

    disableSysProxy(false)
    if (file.endsWith('.exe')) {
      // For Windows .exe installer:
      // 1. Exit the app first (this releases file locks)
      // 2. Launch installer with GUI (no /S flag) so user can see progress
      // 3. After installation, manually start the application
      const installerPath = path.join(dataDir(), file)
      // Get current exe path to determine installation path
      // NSIS installer installs to Program Files or user-specified directory
      // Use Start Menu shortcut or try common installation paths
      const currentExePath = exePath()
      const appName = path.basename(currentExePath, '.exe')
      const productName = 'CrowVPN' // Match productName in electron-builder.yml
      
      // Try to get installed path from Start Menu shortcut or use current path as fallback
      // For perMachine installations, default is C:\Program Files\CrowVPN\CrowVPN.exe
      // But user might have changed it, so we'll try multiple approaches
      const startMenuPath = path.join(
        process.env.APPDATA || '',
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        `${productName}.lnk`
      )
      
      console.log('[AutoUpdater] Windows installer path:', installerPath)
      console.log('[AutoUpdater] Current exe path:', currentExePath)
      
      // Show dialog to inform user
      if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '准备安装更新',
          message: '即将退出应用并启动安装程序',
          detail: '安装程序将在安装完成后自动重启应用。\n\n请完成安装程序的所有步骤，安装完成后应用会自动启动。',
          buttons: ['确定']
        }).then(() => {
          setNotQuitDialog()
          
          // Create a script to wait for installer to finish, then start the app
          // Use Start Menu shortcut if available, otherwise try common installation paths
          const restartScript = `
@echo off
timeout /t 2 /nobreak >nul
"${installerPath}" /S
:wait
timeout /t 1 /nobreak >nul
tasklist /FI "IMAGENAME eq ${path.basename(installerPath)}" 2>NUL | find /I /N "${path.basename(installerPath)}">NUL
if "%ERRORLEVEL%"=="0" goto wait
timeout /t 2 /nobreak >nul
REM Try to start from Start Menu shortcut first (most reliable)
if exist "${startMenuPath}" (
  start "" "${startMenuPath}"
) else (
  REM Fallback: try common installation paths
  if exist "C:\\Program Files\\${appName}\\${appName}.exe" (
    start "" "C:\\Program Files\\${appName}\\${appName}.exe"
  ) else if exist "C:\\Program Files (x86)\\${appName}\\${appName}.exe" (
    start "" "C:\\Program Files (x86)\\${appName}\\${appName}.exe"
  ) else (
    REM Last resort: use current path (might be portable installation)
    start "" "${currentExePath}"
  )
)
`
          
          // Write script to temp file
          const scriptPath = path.join(dataDir(), 'restart-after-update.bat')
          writeFile(scriptPath, restartScript, 'utf8').then(() => {
            // Launch the script
            spawn('cmd', ['/C', `"${scriptPath}"`], {
              shell: true,
              detached: true,
              stdio: 'ignore'
            }).unref()
            
            // Quit the app
            app.quit()
          }).catch((err) => {
            console.error('[AutoUpdater] Failed to create restart script:', err)
            // Fallback: just launch installer GUI and quit
            spawn(installerPath, [], {
              detached: true,
              stdio: 'ignore',
              shell: false
            }).unref()
            app.quit()
          })
        })
      } else {
        // If no main window, create script and quit
        setNotQuitDialog()
        
        const restartScript = `
@echo off
timeout /t 2 /nobreak >nul
"${installerPath}" /S
:wait
timeout /t 1 /nobreak >nul
tasklist /FI "IMAGENAME eq ${path.basename(installerPath)}" 2>NUL | find /I /N "${path.basename(installerPath)}">NUL
if "%ERRORLEVEL%"=="0" goto wait
timeout /t 2 /nobreak >nul
REM Try to start from Start Menu shortcut first (most reliable)
if exist "${startMenuPath}" (
  start "" "${startMenuPath}"
) else (
  REM Fallback: try common installation paths
  if exist "C:\\Program Files\\${appName}\\${appName}.exe" (
    start "" "C:\\Program Files\\${appName}\\${appName}.exe"
  ) else if exist "C:\\Program Files (x86)\\${appName}\\${appName}.exe" (
    start "" "C:\\Program Files (x86)\\${appName}\\${appName}.exe"
  ) else (
    REM Last resort: use current path (might be portable installation)
    start "" "${currentExePath}"
  )
)
`
        
        const scriptPath = path.join(dataDir(), 'restart-after-update.bat')
        writeFile(scriptPath, restartScript, 'utf8').then(() => {
          spawn('cmd', ['/C', `"${scriptPath}"`], {
            shell: true,
            detached: true,
            stdio: 'ignore'
          }).unref()
          app.quit()
        }).catch((err) => {
          console.error('[AutoUpdater] Failed to create restart script:', err)
          spawn(installerPath, [], {
            detached: true,
            stdio: 'ignore',
            shell: false
          }).unref()
          app.quit()
        })
      }
    } else if (file.endsWith('.7z')) {
      // For portable Windows .7z:
      // 1. Extract files
      // 2. Quit app
      // 3. Restart app
      await copyFile(path.join(resourcesFilesDir(), '7za.exe'), path.join(dataDir(), '7za.exe'))
      setNotQuitDialog()
      
      // Extract and restart in one command
      spawn(
        'cmd',
        [
          '/C',
          `"timeout /t 2 /nobreak >nul && "${path.join(dataDir(), '7za.exe')}" x -o"${exeDir()}" -y "${path.join(dataDir(), file)}" && timeout /t 1 /nobreak >nul && start "" "${exePath()}""`
        ],
        {
          shell: true,
          detached: true,
          stdio: 'ignore'
        }
      ).unref()
      
      app.quit()
    } else if (file.endsWith('.pkg')) {
      // For macOS .pkg installer:
      // 1. Exit the app first (this releases file locks)
      // 2. Open installer GUI (user can see progress)
      // 3. Monitor installation progress and auto-restart when complete
      const pkgPath = path.join(dataDir(), file)
      // macOS pkg installer installs to /Applications/CrowVPN.app (or /Applications/Sparkle.app for legacy)
      // Try CrowVPN.app first, then fallback to Sparkle.app
      const installedAppPath = '/Applications/CrowVPN.app'
      const legacyAppPath = '/Applications/Sparkle.app'
      
      console.log('[AutoUpdater] macOS installer path:', pkgPath)
      console.log('[AutoUpdater] Installed app path:', installedAppPath)
      
      // Show dialog to inform user
      if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '准备安装更新',
          message: '即将退出应用并启动安装程序',
          detail: '安装程序将在安装完成后自动重启应用。\n\n请完成安装程序的所有步骤（包括输入管理员密码），安装完成后应用会自动启动。',
          buttons: ['确定']
        }).then(() => {
          setNotQuitDialog()
          
          // Create a script to monitor installation and restart
          // Use GUI installer so user can see progress
          const restartScript = `#!/bin/bash
# Wait for app to quit
sleep 2

# Open installer GUI (user can see installation progress)
open "${pkgPath}"

# Monitor installer process and wait for it to complete
# Check for both Installer.app and the package installer process
INSTALLER_RUNNING=true
while [ "$INSTALLER_RUNNING" = true ]; do
  sleep 2
  
  # Check if Installer.app is still running
  if ! pgrep -f "Installer.app" > /dev/null; then
    # Also check if the installer process for our package is running
    # installer command runs as a separate process
    if ! pgrep -f "installer.*${file}" > /dev/null; then
      # Check if installer has finished by looking at the package receipt
      # macOS creates receipts in /private/var/db/receipts/ when installation completes
      # Wait a bit more to ensure installation is fully complete
      sleep 3
      INSTALLER_RUNNING=false
    fi
  fi
done

# Wait a bit more for installation to fully complete and filesystem to sync
sleep 2

# Launch the newly installed app from /Applications
if [ -d "${installedAppPath}" ]; then
  open "${installedAppPath}"
elif [ -d "${legacyAppPath}" ]; then
  open "${legacyAppPath}"
else
  echo "Warning: Could not find installed app at ${installedAppPath} or ${legacyAppPath}" >&2
fi
`
          
          // Write script to temp file
          const scriptPath = path.join(dataDir(), 'restart-after-update.sh')
          writeFile(scriptPath, restartScript, 'utf8').then(() => {
            // Make script executable
            chmod(scriptPath, 0o755).then(() => {
              // Launch the script
              spawn('bash', [scriptPath], {
                detached: true,
                stdio: 'ignore',
                shell: false
              }).unref()
              
              // Quit the app
              app.quit()
            }).catch((err) => {
              console.error('[AutoUpdater] Failed to make script executable:', err)
              // Try to launch script anyway
              spawn('bash', [scriptPath], {
                detached: true,
                stdio: 'ignore',
                shell: false
              }).unref()
              app.quit()
            })
          }).catch((err) => {
            console.error('[AutoUpdater] Failed to create restart script:', err)
            // Fallback: just open installer and quit
            setTimeout(() => {
              shell.openPath(pkgPath).catch((openErr) => {
                console.error('[AutoUpdater] Failed to open installer:', openErr)
              })
            }, 1000)
            app.quit()
          })
        })
      } else {
        // If no main window, create script and quit
        setNotQuitDialog()
        
        const restartScript = `#!/bin/bash
# Wait for app to quit
sleep 2

# Open installer GUI (user can see installation progress)
open "${pkgPath}"

# Monitor installer process and wait for it to complete
# Check for both Installer.app and the package installer process
INSTALLER_RUNNING=true
while [ "$INSTALLER_RUNNING" = true ]; do
  sleep 2
  
  # Check if Installer.app is still running
  if ! pgrep -f "Installer.app" > /dev/null; then
    # Also check if the installer process for our package is running
    # installer command runs as a separate process
    if ! pgrep -f "installer.*${file}" > /dev/null; then
      # Check if installer has finished by looking at the package receipt
      # macOS creates receipts in /private/var/db/receipts/ when installation completes
      # Wait a bit more to ensure installation is fully complete
      sleep 3
      INSTALLER_RUNNING=false
    fi
  fi
done

# Wait a bit more for installation to fully complete and filesystem to sync
sleep 2

# Launch the newly installed app from /Applications
if [ -d "${installedAppPath}" ]; then
  open "${installedAppPath}"
elif [ -d "${legacyAppPath}" ]; then
  open "${legacyAppPath}"
else
  echo "Warning: Could not find installed app at ${installedAppPath} or ${legacyAppPath}" >&2
fi
`
        
        const scriptPath = path.join(dataDir(), 'restart-after-update.sh')
        writeFile(scriptPath, restartScript, 'utf8').then(() => {
          chmod(scriptPath, 0o755).then(() => {
            spawn('bash', [scriptPath], {
              detached: true,
              stdio: 'ignore',
              shell: false
            }).unref()
            app.quit()
          }).catch((err) => {
            console.error('[AutoUpdater] Failed to make script executable:', err)
            spawn('bash', [scriptPath], {
              detached: true,
              stdio: 'ignore',
              shell: false
            }).unref()
            app.quit()
          })
        }).catch((err) => {
          console.error('[AutoUpdater] Failed to create restart script:', err)
          setTimeout(() => {
            shell.openPath(pkgPath).catch((openErr) => {
              console.error('[AutoUpdater] Failed to open installer:', openErr)
            })
          }, 1000)
          app.quit()
        })
      }
    }
  } catch (e) {
    await rm(path.join(dataDir(), file), { force: true })
    if (axios.isCancel(e)) {
      mainWindow?.webContents.send('update-status', {
        downloading: false,
        progress: 0,
        error: '下载已取消'
      })
      return
    } else {
      mainWindow?.webContents.send('update-status', {
        downloading: false,
        progress: 0,
        error: e instanceof Error ? e.message : '下载失败'
      })
    }
    throw e
  } finally {
    downloadCancelToken = null
  }
}

export async function cancelUpdate(): Promise<void> {
  if (downloadCancelToken) {
    downloadCancelToken.cancel('用户取消下载')
    downloadCancelToken = null
  }
}
