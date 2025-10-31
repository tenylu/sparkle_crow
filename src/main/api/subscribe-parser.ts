import axios from 'axios'
import YAML from 'yaml'
import dns from 'dns'
import net from 'net'
import { promisify } from 'util'

const resolveDns = promisify(dns.lookup)

export interface ParsedNode {
  name: string
  type: string
  server: string
  port: number
  country: string
  flag: string
  latency?: number
  status: 'unknown' | 'online' | 'offline' | 'checking'
}

export async function fetchSubscribe(subscribeUrl: string): Promise<string> {
  try {
    console.log('[SubscribeParser] Fetching subscribe:', subscribeUrl)
    const url = new URL(subscribeUrl)
    
    // Try meta format first (includes all node types including vless)
    url.searchParams.set('flag', 'meta')
    let finalUrl = url.toString()
    console.log('[SubscribeParser] Trying with flag=meta:', finalUrl)
    
    let response = await axios.get(finalUrl, {
      responseType: 'text',
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      validateStatus: () => true
    })
    
    let yamlText = typeof response.data === 'string' ? response.data : String(response.data)
    console.log('[SubscribeParser] Fetched YAML length:', yamlText.length)
    
    // Try to parse to see if it has proxies
    try {
      const testDoc = YAML.parse(yamlText)
      if (testDoc && Array.isArray(testDoc.proxies) && testDoc.proxies.length > 0) {
        console.log('[SubscribeParser] flag=meta works, found', testDoc.proxies.length, 'proxies')
        return yamlText
      }
    } catch (e) {
      console.log('[SubscribeParser] flag=meta parse failed, trying without flag...')
    }
    
    // If meta doesn't work, try without flag
    url.searchParams.delete('flag')
    finalUrl = url.toString()
    console.log('[SubscribeParser] Trying original URL without flag:', finalUrl)
    
    response = await axios.get(finalUrl, {
      responseType: 'text',
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      validateStatus: () => true
    })
    
    yamlText = typeof response.data === 'string' ? response.data : String(response.data)
    console.log('[SubscribeParser] Fetched YAML length:', yamlText.length)
    return yamlText
  } catch (error: any) {
    console.error('[SubscribeParser] Fetch error:', error.message)
    throw new Error(`Failed to fetch subscribe: ${error.message}`)
  }
}

export async function parseClashYAML(yamlText: string): Promise<ParsedNode[]> {
  try {
    console.log('[SubscribeParser] Parsing YAML...')
    const doc = YAML.parse(yamlText)
    
    if (!doc || !Array.isArray(doc.proxies)) {
      console.warn('[SubscribeParser] No proxies found in YAML')
      return []
    }
    
    console.log('[SubscribeParser] Found', doc.proxies.length, 'proxies')
    
    // Count proxies by type first
    const typeCounts: Record<string, number> = {}
    doc.proxies.forEach((proxy: any) => {
      const type = proxy.type || 'unknown'
      typeCounts[type] = (typeCounts[type] || 0) + 1
    })
    console.log('[SubscribeParser] Proxies by type:', typeCounts)
    
    // Filter out non-proxy nodes (e.g., traffic info, plan info)
    const filteredProxies = doc.proxies.filter((proxy: any) => {
      const name = proxy.name || ''
      // Hide nodes with these keywords
      return !name.includes('剩余流量') && 
             !name.includes('套餐到期') &&
             !name.includes('节点陆续恢复')
    })
    
    // Return basic node info immediately (fast)
    const basicNodes: ParsedNode[] = filteredProxies.map((proxy: any, index: number) => {
      const country = extractCountry(proxy.name || '')
      const flag = getFlagEmoji(country)
      
      return {
        name: proxy.name || `Node ${index + 1}`,
        type: proxy.type || 'unknown',
        server: proxy.server || '',
        port: proxy.port || 0,
        country: country,
        flag: flag,
        status: 'checking' as const,
        latency: undefined
      }
    })
    
    console.log('[SubscribeParser] Filtered', doc.proxies.length, 'proxies to', basicNodes.length, 'nodes')
    console.log('[SubscribeParser] Returning', basicNodes.length, 'nodes immediately (status: checking)')
    
    // Return immediately with basic info
    // Latency checking will happen asynchronously
    return basicNodes
  } catch (error: any) {
    console.error('[SubscribeParser] Parse error:', error.message)
    throw new Error(`Failed to parse YAML: ${error.message}`)
  }
}

// Asynchronous latency checking function
export async function checkNodeLatency(node: ParsedNode): Promise<ParsedNode> {
  try {
    console.log(`[SubscribeParser] Checking latency for: ${node.name} (${node.type}) at ${node.server}:${node.port}`)
    const latency = await checkLatency(node.server, node.port)
    console.log(`[SubscribeParser] Node ${node.name} latency: ${latency}ms`)
    return {
      ...node,
      status: latency < 3000 ? 'online' : 'offline' as const,
      latency: latency
    }
  } catch (error) {
    console.log(`[SubscribeParser] Node ${node.name} check failed: ${error}`)
    return {
      ...node,
      status: 'offline' as const,
      latency: undefined
    }
  }
}

async function getCountryFromIP(ip: string): Promise<string | null> {
  try {
    // Use ipapi.co to get country from IP
    const response = await axios.get(`https://ipapi.co/${ip}/json/`, { 
      timeout: 5000,
      validateStatus: () => true
    })
    const countryCode = response.data?.country_code
    if (countryCode) {
      console.log(`[SubscribeParser] IP ${ip} is in country: ${countryCode}`)
      return countryCode.toUpperCase()
    }
  } catch (error) {
    console.warn(`[SubscribeParser] Failed to get country for IP ${ip}:`, error)
  }
  return null
}


function isValidIP(ip: string): boolean {
  // Simple IPv4 validation
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  return ipv4Regex.test(ip)
}

async function checkLatency(server: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    
    // Use a simple TCP connection test
    const socket = new net.Socket()
    let isResolved = false
    let timeout: NodeJS.Timeout | null = null
    
    const cleanup = () => {
      if (timeout) {
        try {
          clearTimeout(timeout)
          timeout = null
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      if (socket && !socket.destroyed) {
        try {
          socket.removeAllListeners()
          // Directly destroy the socket without calling end()
          // This prevents socket hang up errors
          socket.destroy()
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }
    
    timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true
        cleanup()
        reject(new Error('Timeout'))
      }
    }, 3000)
    
    const resolveOnce = (latency: number) => {
      if (!isResolved) {
        isResolved = true
        cleanup()
        resolve(latency)
      }
    }
    
    const rejectOnce = (error: Error) => {
      if (!isResolved) {
        isResolved = true
        cleanup()
        reject(error)
      }
    }
    
    socket.once('connect', () => {
      resolveOnce(Date.now() - startTime)
    })
    
    socket.once('error', (error) => {
      rejectOnce(new Error(`Connection failed: ${error.message}`))
    })
    
    socket.once('timeout', () => {
      rejectOnce(new Error('Connection timeout'))
    })
    
    socket.once('close', () => {
      // Socket closed, no action needed
    })
    
    // Set socket options for better handling
    socket.setTimeout(3000)
    socket.setNoDelay(true)
    socket.setKeepAlive(false)
    
    try {
      socket.connect(port, server)
    } catch (error: any) {
      rejectOnce(new Error(`Socket connection error: ${error.message}`))
    }
  })
}

function extractCountry(name: string): string {
  // Try to extract country code from node name (e.g., "US -", "JP-", etc.)
  const countryPattern = /([A-Z]{2})\s*-\s*/i
  const match = name.match(countryPattern)
  if (match && match[1]) {
    console.log(`[extractCountry] Found country code: ${match[1]}`)
    return match[1].toUpperCase()
  }
  
  // Check for emoji flags in the name first
  const emojiToCode: { [key: string]: string } = {
    '🇺🇸': 'US', '🇬🇧': 'GB', '🇯🇵': 'JP', '🇸🇬': 'SG', '🇭🇰': 'HK', '🇨🇳': 'CN', '🇰🇷': 'KR',
    '🇩🇪': 'DE', '🇫🇷': 'FR', '🇨🇦': 'CA', '🇦🇺': 'AU', '🇳🇱': 'NL', '🇸🇪': 'SE', '🇳🇴': 'NO',
    '🇩🇰': 'DK', '🇫🇮': 'FI', '🇪🇸': 'ES', '🇮🇹': 'IT', '🇷🇺': 'RU', '🇮🇳': 'IN', '🇹🇭': 'TH',
    '🇻🇳': 'VN', '🇵🇭': 'PH', '🇮🇩': 'ID', '🇲🇾': 'MY', '🇹🇷': 'TR', '🇧🇷': 'BR', '🇲🇽': 'MX',
    '🇿🇦': 'ZA', '🇮🇪': 'IE', '🇨🇭': 'CH', '🇦🇹': 'AT', '🇧🇪': 'BE', '🇵🇱': 'PL', '🇨🇿': 'CZ',
    '🇷🇴': 'RO', '🇬🇷': 'GR', '🇵🇹': 'PT', '🇮🇱': 'IL', '🇦🇪': 'AE', '🇹🇼': 'TW', '🇲🇴': 'MO'
  }
  
  for (const [emoji, code] of Object.entries(emojiToCode)) {
    if (name.includes(emoji)) {
      console.log(`[extractCountry] Found emoji flag: ${emoji} -> ${code}`)
      return code
    }
  }
  
  // Try to find country name or code in the name (both English and Chinese)
  const countries: { [key: string]: string[] } = {
    'US': ['united states', 'america', 'usa', 'us', '美国', '美西', '洛杉矶', 'los angeles', 'chicago', 'miami', 'san francisco', 'seattle'],
    'GB': ['united kingdom', 'uk', 'england', 'britain', '英国'],
    'JP': ['japan', 'tokyo', '日本', 'tokyo', 'osaka', 'kyoto'],
    'SG': ['singapore', '新加坡'],
    'HK': ['hong kong', 'hongkong', '香港'],
    'CN': ['china', 'chinese', '中国', 'beijing', 'shanghai', 'guangzhou'],
    'KR': ['korea', 'korean', 'seoul', '韩国'],
    'DE': ['germany', 'german', 'berlin', 'frankfurt', '德国'],
    'FR': ['france', 'french', 'paris', '法国'],
    'CA': ['canada', 'toronto', 'vancouver', '加拿大', 'montreal'],
    'AU': ['australia', 'australian', 'sydney', 'melbourne', '澳大利亚', 'brisbane', 'perth'],
    'NL': ['netherlands', 'dutch', 'amsterdam', '荷兰'],
    'SE': ['sweden', 'stockholm', '瑞典'],
    'NO': ['norway', 'oslo', '挪威'],
    'DK': ['denmark', 'copenhagen', '丹麦'],
    'FI': ['finland', 'helsinki', '芬兰'],
    'ES': ['spain', 'madrid', '西班牙', 'barcelona'],
    'IT': ['italy', 'italian', 'milan', 'rome', '意大利', 'florence'],
    'RU': ['russia', 'russian', 'moscow', '俄罗斯'],
    'IN': ['india', 'mumbai', 'bangalore', '印度', 'delhi'],
    'TH': ['thailand', 'bangkok', '泰国'],
    'VN': ['vietnam', 'vietnamese', '越南', 'ho chi minh', 'hanoi'],
    'PH': ['philippines', 'manila', '菲律宾'],
    'ID': ['indonesia', 'jakarta', '印度尼西亚'],
    'MY': ['malaysia', 'kuala lumpur', '马来西亚'],
    'TR': ['turkey', 'istanbul', '土耳其'],
    'BR': ['brazil', 'sao paulo', 'brasil', '巴西'],
    'MX': ['mexico', 'mexico city', '墨西哥'],
    'ZA': ['south africa', '南非'],
    'IE': ['ireland', 'dublin', '爱尔兰'],
    'CH': ['switzerland', '瑞士'],
    'AT': ['austria', 'vienna', '奥地利'],
    'BE': ['belgium', 'brussels', '比利时'],
    'PL': ['poland', 'warsaw', '波兰'],
    'CZ': ['czech republic', 'prague', '捷克'],
    'RO': ['romania', 'bucharest', '罗马尼亚'],
    'GR': ['greece', 'athens', '希腊'],
    'PT': ['portugal', 'lisbon', '葡萄牙'],
    'IL': ['israel', 'tel aviv', '以色列'],
    'AE': ['uae', 'dubai', 'abu dhabi', '阿联酋', '迪拜'],
    'TW': ['taiwan', 'taipei', '台湾'],
    'MO': ['macau', 'macao', '澳门']
  }
  
  const nameLower = name.toLowerCase()
  for (const [code, keywords] of Object.entries(countries)) {
    if (keywords.some(keyword => nameLower.includes(keyword) || name.includes(keyword))) {
      console.log(`[extractCountry] Matched "${name}" -> ${code} via keyword: ${keywords.find(k => nameLower.includes(k) || name.includes(k))}`)
      return code
    }
  }
  
  // Check for city names that indicate location
  const cityCountries: { [key: string]: string } = {
    'los angeles': 'US', 'new york': 'US', 'chicago': 'US', 'miami': 'US', 'san francisco': 'US', 'seattle': 'US',
    'london': 'GB', 'manchester': 'GB', 'edinburgh': 'GB',
    'tokyo': 'JP', 'osaka': 'JP', 'kyoto': 'JP',
    'singapore': 'SG',
    'sydney': 'AU', 'melbourne': 'AU', 'brisbane': 'AU',
    'toronto': 'CA', 'vancouver': 'CA', 'montreal': 'CA',
    'mumbai': 'IN', 'delhi': 'IN', 'bangalore': 'IN',
    'dubai': 'AE', 'abudhabi': 'AE'
  }
  
  for (const [city, code] of Object.entries(cityCountries)) {
    if (nameLower.includes(city)) {
      return code
    }
  }
  
  return 'XX' // Unknown
}

function getFlagEmoji(country: string): string {
  const flags: { [key: string]: string } = {
    'US': '🇺🇸', 'GB': '🇬🇧', 'UK': '🇬🇧', 'JP': '🇯🇵', 'SG': '🇸🇬', 'HK': '🇭🇰',
    'CN': '🇨🇳', 'KR': '🇰🇷', 'DE': '🇩🇪', 'FR': '🇫🇷', 'CA': '🇨🇦', 'AU': '🇦🇺',
    'NL': '🇳🇱', 'SE': '🇸🇪', 'NO': '🇳🇴', 'DK': '🇩🇰', 'FI': '🇫🇮', 'ES': '🇪🇸',
    'IT': '🇮🇹', 'RU': '🇷🇺', 'IN': '🇮🇳', 'TH': '🇹🇭', 'VN': '🇻🇳', 'PH': '🇵🇭',
    'ID': '🇮🇩', 'MY': '🇲🇾', 'TR': '🇹🇷', 'BR': '🇧🇷', 'MX': '🇲🇽', 'ZA': '🇿🇦',
    'IE': '🇮🇪', 'CH': '🇨🇭', 'AT': '🇦🇹', 'BE': '🇧🇪', 'PL': '🇵🇱', 'CZ': '🇨🇿',
    'RO': '🇷🇴', 'GR': '🇬🇷', 'PT': '🇵🇹', 'IL': '🇮🇱', 'AE': '🇦🇪', 'TW': '🇹🇼',
    'MO': '🇲🇴', 'XX': '🌐'
  }
  return flags[country] || flags['XX']
}

// Simulate latency check (in real implementation, this would ping the server)
export function simulateLatencyCheck(): number {
  // Return a random latency between 10-300ms
  return Math.floor(Math.random() * 290) + 10
}

