import os from 'os'
import dns from 'dns'

/**
 * 检查是否为私有IPv4地址 (RFC1918)
 */
function isPrivateIPv4(addr: string): boolean {
  // 10.0.0.0/8
  if (addr.startsWith('10.')) return true
  // 172.16.0.0/12
  if (addr.match(/^172\.(1[6-9]|2\d|3[01])\./)) return true
  // 192.168.0.0/16
  if (addr.startsWith('192.168.')) return true
  return false
}

/**
 * 检查是否为本地链路地址（169.254.x.x）
 */
function isLinkLocalIPv4(addr: string): boolean {
  return addr.startsWith('169.254.')
}

/**
 * 检查是否为IPv6的ULA（Unique Local Address）
 */
function isIPv6ULA(addr: string): boolean {
  // fc00::/7 = fc00:: 到 fdff::
  return /^fc[0-9a-f][0-9a-f]:/.test(addr) || /^fd[0-9a-f][0-9a-f]:/.test(addr)
}

/**
 * 判断接口名称是否为虚拟接口（用于过滤 Docker、VPN、隧道等）
 */
function isVirtualInterface(name: string): boolean {
  const virtualKeywords = [
    'docker',
    'veth',
    'br-',
    'lo',
    'tun',
    'tap',
    'ppp',
    'wlan',
    'bridge',
    'virbr',
    'vmnet',
    'utun',
    'gif',
    'stf'
  ]
  const lowerName = name.toLowerCase()
  return virtualKeywords.some(keyword => lowerName.includes(keyword))
}

export interface LANIPInfo {
  ip: string
  interface: string
  family: 'IPv4' | 'IPv6'
  isPrivate?: boolean
  isULA?: boolean
}

/**
 * 获取最佳LAN IP地址
 * 优先级：私有IPv4 > IPv6 ULA > 其他
 */
export function getBestLANIP(): string {
  const networkInterfaces = os.networkInterfaces()
  if (!networkInterfaces) {
    console.log('[net.ts] No network interfaces found')
    return '127.0.0.1'
  }

  console.log('[net.ts] Scanning network interfaces...')
  
  // 优先查找私有IPv4
  for (const [name, addrs] of Object.entries(networkInterfaces)) {
    if (!addrs) continue
    
    const isVirtual = isVirtualInterface(name)
    console.log(`[net.ts] Interface: ${name}, virtual: ${isVirtual}, addresses: ${addrs.length}`)
    
    if (isVirtual) continue
    
    for (const addr of addrs) {
      console.log(`[net.ts]   - ${addr.address} (${addr.family}, internal: ${addr.internal})`)
      
      if (addr.family === 'IPv4' && !addr.internal && 
          addr.address !== '127.0.0.1' && 
          !isLinkLocalIPv4(addr.address)) {
        const isPrivate = isPrivateIPv4(addr.address)
        console.log(`[net.ts]     Check: ${addr.address}, private: ${isPrivate}`)
        
        // 优先返回私有IPv4
        if (isPrivate) {
          console.log(`[net.ts] Selected best LAN IP: ${addr.address} from ${name}`)
          return addr.address
        }
      }
    }
  }
  
  // 没有私有IPv4，查找IPv6 ULA
  console.log('[net.ts] No private IPv4 found, trying IPv6 ULA...')
  for (const [name, addrs] of Object.entries(networkInterfaces)) {
    if (!addrs || isVirtualInterface(name)) continue
    
    for (const addr of addrs) {
      if (addr.family === 'IPv6' && !addr.internal && isIPv6ULA(addr.address)) {
        console.log(`[net.ts] Selected IPv6 ULA: ${addr.address}`)
        return addr.address
      }
    }
  }
  
  console.log('[net.ts] No suitable LAN IP found, returning 127.0.0.1')
  return '127.0.0.1'
}

/**
 * 列出所有可用的LAN IP地址
 */
export function listLANIPs(): LANIPInfo[] {
  const networkInterfaces = os.networkInterfaces()
  const result: LANIPInfo[] = []
  
  if (!networkInterfaces) {
    console.log('[net.ts] No network interfaces for listing')
    return result
  }
  
  console.log('[net.ts] Listing LAN IPs...')
  
  for (const [name, addrs] of Object.entries(networkInterfaces)) {
    if (!addrs) continue
    
    const isVirtual = isVirtualInterface(name)
    if (isVirtual) {
      console.log(`[net.ts] Skipping virtual interface: ${name}`)
      continue
    }
    
    for (const addr of addrs) {
      // IPv4：私有地址
      if (addr.family === 'IPv4' && !addr.internal && 
          addr.address !== '127.0.0.1' && 
          !isLinkLocalIPv4(addr.address)) {
        const isPrivate = isPrivateIPv4(addr.address)
        console.log(`[net.ts] Found IPv4: ${addr.address} from ${name}, private: ${isPrivate}`)
        result.push({
          ip: addr.address,
          interface: name,
          family: 'IPv4',
          isPrivate: isPrivate
        })
      }
      // IPv6：ULA地址
      if (addr.family === 'IPv6' && !addr.internal && isIPv6ULA(addr.address)) {
        console.log(`[net.ts] Found IPv6 ULA: ${addr.address} from ${name}`)
        result.push({
          ip: addr.address,
          interface: name,
          family: 'IPv6',
          isULA: true
        })
      }
    }
  }
  
  // 去重并按优先级排序
  const uniqueIPs = new Map<string, LANIPInfo>()
  result.forEach(ip => uniqueIPs.set(ip.ip, ip))
  
  const sorted = Array.from(uniqueIPs.values()).sort((a, b) => {
    // 私有IPv4优先
    if (a.isPrivate && !b.isPrivate) return -1
    if (!a.isPrivate && b.isPrivate) return 1
    // 同类型按地址排序
    return a.ip.localeCompare(b.ip)
  })
  
  console.log(`[net.ts] Listed ${sorted.length} LAN IPs:`, sorted.map(i => i.ip).join(', '))
  
  return sorted
}

export async function resolveDomainIPs(host: string): Promise<string[]> {
  try {
    const results = await dns.promises.lookup(host, { all: true, verbatim: true })
    const ips = new Set<string>()
    for (const result of results) {
      if (result?.address) {
        ips.add(result.address)
      }
    }
    return Array.from(ips)
  } catch (error) {
    console.warn('[net.ts] Failed to resolve domain IPs for', host, error)
    return []
  }
}

