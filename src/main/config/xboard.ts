import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const CONFIG_FILE = path.join(app.getPath('userData'), 'xboard-config.json')
const PROXY_STATE_FILE = path.join(app.getPath('userData'), 'xboard-proxy-state.json')

export interface XboardConfig {
  baseURL: string
  token: string
  email: string
}

export interface XboardProxyState {
  selectedNodeName?: string
  mode?: 'rule' | 'global'
  proxies?: any[]
  rules?: any[]
  proxyGroups?: any[]
}

function readConfig(): XboardConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Failed to read config:', error)
  }
  return null
}

function writeConfig(config: XboardConfig): void {
  try {
    const dir = path.dirname(CONFIG_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to write config:', error)
    throw error
  }
}

export function getXboardConfig(): XboardConfig | null {
  return readConfig()
}

export function setXboardConfig(config: Partial<XboardConfig>): void {
  const current = readConfig() || { baseURL: '', token: '', email: '' }
  const updated = { ...current, ...config }
  writeConfig(updated)
}

export function isLoggedIn(): boolean {
  const config = getXboardConfig()
  return !!(config?.token && config?.baseURL)
}

export function clearXboardConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE)
    }
  } catch (error) {
    console.error('Failed to clear config:', error)
  }
}

// Proxy state management
function readProxyState(): XboardProxyState | null {
  try {
    if (fs.existsSync(PROXY_STATE_FILE)) {
      const data = fs.readFileSync(PROXY_STATE_FILE, 'utf-8')
      const state = JSON.parse(data)
      console.log('[ProxyState] Read proxy state from:', PROXY_STATE_FILE, 'selected:', state.selectedNodeName)
      return state
    }
  } catch (error) {
    console.error('Failed to read proxy state:', error)
  }
  return null
}

function writeProxyState(state: XboardProxyState): void {
  try {
    const dir = path.dirname(PROXY_STATE_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(PROXY_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
    console.log('[ProxyState] Written proxy state to:', PROXY_STATE_FILE)
  } catch (error) {
    console.error('Failed to write proxy state:', error)
    throw error
  }
}

export function getXboardProxyState(): XboardProxyState | null {
  return readProxyState()
}

export function setXboardProxyState(state: Partial<XboardProxyState>): void {
  const current =
    readProxyState() ||
    {
      selectedNodeName: undefined,
      mode: undefined,
      proxies: undefined,
      rules: undefined,
      proxyGroups: undefined
    }
  const updated = { ...current, ...state }
  writeProxyState(updated)
}

/**
 * Build unified Xboard configuration combining proxy, TUN, and other settings
 */
export async function buildXboardConfig(): Promise<any> {
  const { getControledMihomoConfig } = await import('./controledMihomo')
  const proxyState = getXboardProxyState()
  const controledMihomoConfig = await getControledMihomoConfig(true) // Force refresh from disk
  
  console.log('[buildXboardConfig] Proxy state:', JSON.stringify(proxyState))
  console.log('[buildXboardConfig] TUN config:', JSON.stringify(controledMihomoConfig.tun))
  
  // Start with TUN/DNS/ports from controledMihomoConfig
  const config: any = {
    port: 0,
    'socks-port': 0,
    'mixed-port': controledMihomoConfig['mixed-port'] || 7890,
    'allow-lan': controledMihomoConfig['allow-lan'] || false,
    'log-level': 'info',
    'external-controller': '127.0.0.1:9090',
    'secret': '',
    tun: controledMihomoConfig.tun || { enable: false },
    dns: controledMihomoConfig.dns || { enable: true },
  }
  
  // If no proxy state, return minimal config
  if (!proxyState?.proxies || !proxyState.selectedNodeName) {
    console.log('[buildXboardConfig] No proxy state, returning minimal config')
    return config
  }
  
  console.log('[buildXboardConfig] Adding proxies and rules, selected node:', proxyState.selectedNodeName)
  
  // Add proxies and rules
  config.proxies = proxyState.proxies
  config.proxy = proxyState.selectedNodeName
  config.mode = proxyState.mode || 'rule'
  if (Array.isArray(proxyState.proxyGroups) && proxyState.proxyGroups.length > 0) {
    const clonedGroups = proxyState.proxyGroups.map((group: any) => ({ ...group }))
    const hasGlobal = clonedGroups.some((group: any) => group?.name === 'GLOBAL')
    if (!hasGlobal) {
      clonedGroups.push({
        name: 'GLOBAL',
        type: 'select',
        proxies: [proxyState.selectedNodeName, 'DIRECT']
      })
    }
    config['proxy-groups'] = clonedGroups
  } else {
    config['proxy-groups'] = [
      {
        name: 'GLOBAL',
        type: 'select',
        proxies: [proxyState.selectedNodeName, 'DIRECT']
      }
    ]
  }
  
  if (proxyState.mode === 'global') {
    config.rules = [`MATCH,${proxyState.selectedNodeName}`]
  } else {
    config.rules = [
      'DOMAIN-SUFFIX,local,DIRECT',
      'IP-CIDR,127.0.0.0/8,DIRECT',
      'IP-CIDR,172.16.0.0/12,DIRECT',
      'IP-CIDR,192.168.0.0/16,DIRECT',
      'IP-CIDR,10.0.0.0/8,DIRECT',
      'GEOIP,CN,DIRECT',
      `MATCH,${proxyState.selectedNodeName}`
    ]
  }
  
  // Add panel IP and LAN ranges to TUN route-exclude if TUN is enabled
  if (config.tun?.enable) {
    try {
      const { getBestLANIP } = await import('../utils/net')
      const lanIP = getBestLANIP()
      config.tun['route-exclude-address'] = ['127.0.0.1/32']
      if (lanIP && lanIP !== '127.0.0.1') {
        config.tun['route-exclude-address'].push(`${lanIP}/32`)
        console.log('[Xboard Config] Added panel IP to TUN route-exclude:', lanIP)
      } else {
        console.log('[Xboard Config] Only localhost in TUN route-exclude')
      }
      // Add LAN ranges to prevent routing panel traffic through TUN
      config.tun['route-exclude-address'].push('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')
    } catch (error) {
      console.error('[Xboard Config] Failed to get LAN IP:', error)
      config.tun['route-exclude-address'] = ['127.0.0.1/32', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
    }
  }
  
  console.log('[buildXboardConfig] Final config - proxies:', config.proxies?.length || 0, 'selected:', config.proxy, 'tun:', config.tun?.enable)
  
  return config
}


