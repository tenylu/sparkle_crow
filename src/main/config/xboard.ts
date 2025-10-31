import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const CONFIG_FILE = path.join(app.getPath('userData'), 'xboard-config.json')

export interface XboardConfig {
  baseURL: string
  token: string
  email: string
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


