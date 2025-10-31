import axios, { AxiosRequestConfig, CancelTokenSource } from 'axios'
import { parseYaml } from '../utils/yaml'
import { app, shell } from 'electron'
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
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const { updateChannel = 'stable' } = await getAppConfig()
  
  // Cloudflare R2 URL - replace with your actual R2 bucket URL
  const baseUrl = 'https://update.crowmesh.com'
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
    responseType: 'text'
  })
  const latest = parseYaml<AppVersion>(res.data)
  const currentVersion = app.getVersion()
  if (latest.version !== currentVersion) {
    return latest
  } else {
    return undefined
  }
}

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  
  // Cloudflare R2 URL
  const baseUrl = 'https://update.crowmesh.com'
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
      spawn(path.join(dataDir(), file), ['/S', '--force-run'], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    }
    if (file.endsWith('.7z')) {
      await copyFile(path.join(resourcesFilesDir(), '7za.exe'), path.join(dataDir(), '7za.exe'))
      spawn(
        'cmd',
        [
          '/C',
          `"timeout /t 2 /nobreak >nul && "${path.join(dataDir(), '7za.exe')}" x -o"${exeDir()}" -y "${path.join(dataDir(), file)}" & start "" "${exePath()}""`
        ],
        {
          shell: true,
          detached: true
        }
      ).unref()
      setNotQuitDialog()
      app.quit()
    }
    if (file.endsWith('.pkg')) {
      try {
        const pkgPath = path.join(dataDir(), file)
        
        // Use open command to launch the pkg installer
        // This will use the system installer which already has proper branding
        setNotQuitDialog()
        app.quit()
        
        // Wait a bit for the app to quit, then open the installer
        setTimeout(() => {
          shell.openPath(pkgPath)
        }, 500)
      } catch {
        shell.openPath(path.join(dataDir(), file))
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
