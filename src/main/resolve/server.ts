import { getAppConfig, getControledMihomoConfig } from '../config'
import { Worker } from 'worker_threads'
import { mihomoWorkDir, subStoreDir, substoreLogPath } from '../utils/dirs'
import subStoreIcon from '../../../resources/subStoreIcon.png?asset'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { writeFile, rm, cp } from 'fs/promises'
import http from 'http'
import net from 'net'
import path from 'path'
import { nativeImage } from 'electron'
import express from 'express'
import axios from 'axios'
import AdmZip from 'adm-zip'

export let pacPort: number
export let subStorePort: number
export let subStoreFrontendPort: number
let subStoreFrontendServer: http.Server
let subStoreBackendWorker: Worker

const defaultPacScript = `
function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; DIRECT;";
}
`

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Find an available port starting from startPort, only if startPort is not available
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  const available = await isPortAvailable(startPort)
  if (available) {
    return startPort
  }
  
  // Only search for new port if the requested port is not available
  return new Promise((resolve, reject) => {
    let currentPort = startPort + 1
    const tryNextPort = () => {
      if (currentPort > 65535) {
        reject(new Error(`No available port found starting from ${startPort}`))
        return
      }
      const server = net.createServer()
      server.on('error', () => {
        currentPort++
        tryNextPort()
      })
      server.on('listening', () => {
        server.close(() => {
          resolve(currentPort)
        })
      })
      server.listen(currentPort, '127.0.0.1')
    }
    tryNextPort()
  })
}

let pacServer: http.Server

export async function startPacServer(): Promise<void> {
  await stopPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode = 'manual', host: cHost, pacScript } = sysProxy
  if (mode !== 'auto') {
    return
  }
  const host = cHost || '127.0.0.1'
  let script = pacScript || defaultPacScript
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  script = script.replaceAll('%mixed-port%', port.toString())
  // Try to use fixed port 10000, only find new port if it's occupied
  pacPort = await findAvailablePort(10000)
  pacServer = http
    .createServer(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' })
      res.end(script)
    })
    .listen(pacPort, host)
}

export async function stopPacServer(): Promise<void> {
  if (pacServer) {
    pacServer.close()
  }
}

export async function startSubStoreFrontendServer(): Promise<void> {
  const { useSubStore = true, subStoreHost = '127.0.0.1' } = await getAppConfig()
  if (!useSubStore) return
  await stopSubStoreFrontendServer()
  // Try to use fixed port 14122, only find new port if it's occupied
  subStoreFrontendPort = await findAvailablePort(14122)
  const app = express()
  app.use(express.static(path.join(mihomoWorkDir(), 'sub-store-frontend')))
  subStoreFrontendServer = app.listen(subStoreFrontendPort, subStoreHost)
}

export async function stopSubStoreFrontendServer(): Promise<void> {
  if (subStoreFrontendServer) {
    subStoreFrontendServer.close()
  }
}

export async function startSubStoreBackendServer(): Promise<void> {
  const {
    useSubStore = true,
    useCustomSubStore = false,
    useProxyInSubStore = false,
    subStoreHost = '127.0.0.1',
    subStoreBackendSyncCron = '',
    subStoreBackendDownloadCron = '',
    subStoreBackendUploadCron = ''
  } = await getAppConfig()
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  if (!useSubStore) return
  if (!useCustomSubStore) {
    await stopSubStoreBackendServer()
    // Try to use fixed port 38324, only find new port if it's occupied
    subStorePort = await findAvailablePort(38324)
    const icon = nativeImage.createFromPath(subStoreIcon)
    icon.toDataURL()
    const stdout = createWriteStream(substoreLogPath(), { flags: 'a' })
    const stderr = createWriteStream(substoreLogPath(), { flags: 'a' })
    const env = {
      SUB_STORE_BACKEND_API_PORT: subStorePort.toString(),
      SUB_STORE_BACKEND_API_HOST: subStoreHost,
      SUB_STORE_DATA_BASE_PATH: subStoreDir(),
      SUB_STORE_BACKEND_CUSTOM_ICON: icon.toDataURL(),
      SUB_STORE_BACKEND_CUSTOM_NAME: 'CrowVPN',
      SUB_STORE_BACKEND_SYNC_CRON: subStoreBackendSyncCron,
      SUB_STORE_BACKEND_DOWNLOAD_CRON: subStoreBackendDownloadCron,
      SUB_STORE_BACKEND_UPLOAD_CRON: subStoreBackendUploadCron,
      SUB_STORE_MMDB_COUNTRY_PATH: path.join(mihomoWorkDir(), 'country.mmdb'),
      SUB_STORE_MMDB_ASN_PATH: path.join(mihomoWorkDir(), 'ASN.mmdb')
    }
    subStoreBackendWorker = new Worker(path.join(mihomoWorkDir(), 'sub-store.bundle.js'), {
      env: useProxyInSubStore
        ? {
            ...env,
            HTTP_PROXY: `http://127.0.0.1:${port}`,
            HTTPS_PROXY: `http://127.0.0.1:${port}`,
            ALL_PROXY: `http://127.0.0.1:${port}`
          }
        : env
    })
    subStoreBackendWorker.stdout.pipe(stdout)
    subStoreBackendWorker.stderr.pipe(stderr)
  }
}

export async function stopSubStoreBackendServer(): Promise<void> {
  if (subStoreBackendWorker) {
    subStoreBackendWorker.terminate()
  }
}

export async function downloadSubStore(): Promise<void> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const frontendDir = path.join(mihomoWorkDir(), 'sub-store-frontend')
  const backendPath = path.join(mihomoWorkDir(), 'sub-store.bundle.js')
  const tempDir = path.join(mihomoWorkDir(), 'temp')

  try {
    // 下载后端文件
    const backendRes = await axios.get(
      'https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js',
      {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/octet-stream' },
        ...(mixedPort != 0 && {
          proxy: {
            protocol: 'http',
            host: '127.0.0.1',
            port: mixedPort
          }
        }),
        validateStatus: () => true
      }
    )
    await writeFile(backendPath, Buffer.from(backendRes.data))

    // 下载前端文件
    const frontendRes = await axios.get(
      'https://github.com/sub-store-org/Sub-Store-Front-End/releases/latest/download/dist.zip',
      {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/octet-stream' },
        ...(mixedPort != 0 && {
          proxy: {
            protocol: 'http',
            host: '127.0.0.1',
            port: mixedPort
          }
        }),
        validateStatus: () => true
      }
    )

    // 创建临时目录
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true })
    }
    mkdirSync(tempDir, { recursive: true })

    // 先解压到临时目录
    const zip = new AdmZip(Buffer.from(frontendRes.data))
    zip.extractAllTo(tempDir, true)

    // 确保目标目录存在并清空
    if (existsSync(frontendDir)) {
      await rm(frontendDir, { recursive: true })
    }
    mkdirSync(frontendDir, { recursive: true })

    // 将 dist 目录中的内容移动到目标目录
    await cp(path.join(tempDir, 'dist'), frontendDir, { recursive: true })

    // 清理临时目录
    await rm(tempDir, { recursive: true })
  } catch (error) {
    console.error('下载 Sub-Store 文件失败：', error)
    throw error
  }
}
