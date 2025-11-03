import { controledMihomoConfigPath } from '../utils/dirs'
import { readFile, writeFile } from 'fs/promises'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { generateProfile } from '../core/factory'
import { getAppConfig } from './app'
import { defaultControledMihomoConfig } from '../utils/template'
import { deepMerge } from '../utils/merge'

let controledMihomoConfig: Partial<MihomoConfig> // mihomo.yaml

export async function getControledMihomoConfig(force = false): Promise<Partial<MihomoConfig>> {
  if (force || !controledMihomoConfig) {
    const data = await readFile(controledMihomoConfigPath(), 'utf-8')
    controledMihomoConfig = parseYaml<Partial<MihomoConfig>>(data) || defaultControledMihomoConfig
  }
  if (typeof controledMihomoConfig !== 'object')
    controledMihomoConfig = defaultControledMihomoConfig
  return controledMihomoConfig
}

export async function patchControledMihomoConfig(patch: Partial<MihomoConfig>, autoGenerateProfile = true): Promise<void> {
  // Ensure we have a valid controledMihomoConfig before processing
  await getControledMihomoConfig()
  
  const { controlDns = true, controlSniff = true } = await getAppConfig()
  console.log('[patchControledMihomoConfig] Before processing, controledMihomoConfig.tun:', JSON.stringify(controledMihomoConfig.tun))
  console.log('[patchControledMihomoConfig] Patch:', JSON.stringify(patch))
  if (!controlDns) {
    delete controledMihomoConfig.dns
    delete controledMihomoConfig.hosts
  } else {
    // 从不接管状态恢复
    if (controledMihomoConfig.dns?.ipv6 === undefined) {
      controledMihomoConfig.dns = defaultControledMihomoConfig.dns
    }
  }
  if (!controlSniff) {
    delete controledMihomoConfig.sniffer
  } else {
    // 从不接管状态恢复
    if (!controledMihomoConfig.sniffer) {
      controledMihomoConfig.sniffer = defaultControledMihomoConfig.sniffer
    }
  }
  if (patch.dns?.['nameserver-policy']) {
    controledMihomoConfig.dns = controledMihomoConfig.dns || {}
    controledMihomoConfig.dns['nameserver-policy'] = patch.dns['nameserver-policy']
  }
  if (patch.dns?.['use-hosts']) {
    controledMihomoConfig.hosts = patch.hosts
  }
  controledMihomoConfig = deepMerge(controledMihomoConfig, patch)
  
  // Ensure macOS TUN stack is set to 'system' for proper functionality
  if (process.platform === 'darwin' && controledMihomoConfig.tun?.enable) {
    controledMihomoConfig.tun.stack = 'system'
    controledMihomoConfig.tun['auto-route'] = true
    controledMihomoConfig.tun['auto-detect-interface'] = true
  }
  
  console.log('[patchControledMihomoConfig] After merge, controledMihomoConfig.tun:', JSON.stringify(controledMihomoConfig.tun))
  await writeFile(controledMihomoConfigPath(), stringifyYaml(controledMihomoConfig), 'utf-8')
  console.log('[patchControledMihomoConfig] Wrote to file')
  
  if (autoGenerateProfile) {
    console.log('[patchControledMihomoConfig] Calling generateProfile')
    await generateProfile()
    console.log('[patchControledMihomoConfig] generateProfile completed')
    // Clear cache after generateProfile to ensure fresh reads
    controledMihomoConfig = null as any
  } else {
    console.log('[patchControledMihomoConfig] Skipping generateProfile (will be called later)')
    // Clear cache so next getControledMihomoConfig() reads from disk
    controledMihomoConfig = null as any
  }
}
