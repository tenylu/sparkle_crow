import axios, { AxiosRequestConfig, CancelTokenSource } from 'axios'
import { parseYaml } from '../utils/yaml'
import { app, shell, dialog } from 'electron'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { dataDir, exeDir, exePath, isPortable, resourcesFilesDir } from '../utils/dirs'
import { copyFile, rm, writeFile, readFile } from 'fs/promises'
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
    
    const res = await axios.get(url, {
      headers: { 'Content-Type': 'application/octet-stream' },
      ...(mixedPort != 0 && {
        proxy: {
          protocol: 'http',
          host: '127.0.0.1',
          port: mixedPort
        }
      }),
      validateStatus: () => true,
      responseType: 'text',
      timeout: 10000
    })
    
    // Check if request was successful
    if (res.status !== 200 || !res.data) {
      console.error('[AutoUpdater] Failed to fetch update info:', res.status, res.statusText)
      return undefined
    }
    
    // Parse YAML
    let latestVersionInfo: AppVersion
    try {
      latestVersionInfo = parseYaml<AppVersion>(res.data)
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
    
    // Compare versions using semver-like logic
    // Only return update if latest version is newer than current version
    if (latestVersionInfo.version === currentVersion) {
      return undefined
    }
    
    // Parse version strings (e.g., "2.0.4" -> [2, 0, 4])
    const parseVersion = (version: string): number[] => {
      return version.split('.').map(Number)
    }
    
    const currentParts = parseVersion(currentVersion)
    const latestParts = parseVersion(latestVersionInfo.version)
    
    // Compare version arrays
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
      const currentPart = currentParts[i] || 0
      const latestPart = latestParts[i] || 0
      
      if (latestPart > currentPart) {
        // Latest version is newer, return update info
        return latestVersionInfo
      } else if (latestPart < currentPart) {
        // Latest version is older, don't update
        return undefined
      }
    }
    
    // Versions are equal (shouldn't happen due to first check, but just in case)
    return undefined
  } catch (error: any) {
    console.error('[AutoUpdater] Error checking for updates:', error.message)
    return undefined
  }
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
      // 2. Launch installer with /S (silent) flag
      // 3. Installer will automatically restart the app after installation (via runAfterFinish: true)
      const installerPath = path.join(dataDir(), file)
      
      // Show dialog to inform user
      if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '准备安装更新',
          message: '即将退出应用并启动安装程序',
          detail: '安装程序将在安装完成后自动重启应用。',
          buttons: ['确定']
        }).then(() => {
          setNotQuitDialog()
          app.quit()
          
          // Wait for app to quit, then launch installer
          setTimeout(() => {
            spawn(installerPath, ['/S'], {
              detached: true,
              stdio: 'ignore',
              shell: false
            }).unref()
          }, 1000)
        })
      } else {
        // If no main window, just quit and launch installer
        setNotQuitDialog()
        app.quit()
        
        setTimeout(() => {
          spawn(installerPath, ['/S'], {
            detached: true,
            stdio: 'ignore',
            shell: false
          }).unref()
        }, 1000)
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
      // 1. Show message to user that installation will start
      // 2. Quit app
      // 3. Launch installer
      // Note: User must manually complete installation and restart app
      const pkgPath = path.join(dataDir(), file)
      
      // Show dialog to inform user
      if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '准备安装更新',
          message: '即将退出应用并启动安装程序',
          detail: '安装完成后，请手动重新打开应用。',
          buttons: ['确定']
        }).then(() => {
          setNotQuitDialog()
          app.quit()
          
          // Wait for app to quit, then open installer
          setTimeout(() => {
            shell.openPath(pkgPath).catch((err) => {
              console.error('[AutoUpdater] Failed to open installer:', err)
            })
          }, 1000)
        })
      } else {
        // If no main window, just quit and open installer
        setNotQuitDialog()
        app.quit()
        
        setTimeout(() => {
          shell.openPath(pkgPath).catch((err) => {
            console.error('[AutoUpdater] Failed to open installer:', err)
          })
        }, 1000)
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
