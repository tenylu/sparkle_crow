import axios, { AxiosInstance } from 'axios'
import type { LoginRequest, LoginResponse, UserInfo, SubscribeInfo, AuthError } from '../../../shared/types/xboard'

/**
 * List of available server domains to try
 * Order matters: first domain will be tried first
 */
export const XBOARD_SERVER_DOMAINS = [
  'https://xb.crowmesh.com',
  'https://user.crowmesh.com',
  'https://api.crowmesh.com',
  'https://user.koalaid.com',
  'http://v3.koalaid.com',
]

export class XboardClient {
  private baseURL: string
  private http: AxiosInstance
  private readonly maxRetries = 3
  private readonly retryDelay = 1000 // Initial delay in ms

  constructor(baseURL: string) {
    this.baseURL = baseURL.replace(/\/$/, '') // Remove trailing slash
    this.http = axios.create({
      baseURL: this.baseURL,
      timeout: 30000, // Increased from 15000 to 30000 (30 seconds)
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      validateStatus: () => true // Accept all status codes
    })
  }

  /**
   * Check if a domain is reachable by making a lightweight request
   */
  static async checkDomainReachable(baseURL: string, timeout: number = 5000): Promise<boolean> {
    try {
      const testClient = axios.create({
        baseURL: baseURL.replace(/\/$/, ''),
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        validateStatus: () => true
      })
      
      // Try to access a lightweight endpoint (health check or API root)
      // We'll try the login endpoint but with a short timeout just to check connectivity
      const response = await testClient.get('/api/v1/guest/plan/fetch', { timeout })
      
      // If we get any response (even 401/403), the server is reachable
      // Only fail if it's a network error
      return response.status > 0
    } catch (error: any) {
      // Network errors mean domain is not reachable
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || 
          error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' ||
          error.code === 'ENETUNREACH' || error.response?.status === 0) {
        return false
      }
      // Other errors (like 401, 403) mean server is reachable but requires auth
      return true
    }
  }

  /**
   * Find the first reachable domain from the list
   * @param preferredDomain Optional preferred domain to try first
   * @returns The first reachable domain, or null if none are reachable
   */
  static async findAvailableDomain(preferredDomain?: string): Promise<string | null> {
    const domainsToTry = preferredDomain 
      ? [preferredDomain, ...XBOARD_SERVER_DOMAINS.filter(d => d !== preferredDomain)]
      : XBOARD_SERVER_DOMAINS

    console.log('[XboardClient] Checking available domains:', domainsToTry)

    for (const domain of domainsToTry) {
      try {
        console.log(`[XboardClient] Checking domain: ${domain}`)
        const isReachable = await this.checkDomainReachable(domain, 5000)
        
        if (isReachable) {
          console.log(`[XboardClient] Domain ${domain} is reachable`)
          return domain
        } else {
          console.log(`[XboardClient] Domain ${domain} is not reachable`)
        }
      } catch (error: any) {
        console.log(`[XboardClient] Error checking domain ${domain}:`, error.message)
        continue
      }
    }

    console.warn('[XboardClient] No reachable domains found')
    return null
  }

  /**
   * Check if error indicates server is reachable (but request failed)
   * Returns true if server is reachable, false if it's a network error
   */
  private static isServerReachable(error: any): boolean {
    // If we got a response from server (even error), server is reachable
    if (error.response && error.response.status) {
      return true
    }
    
    // Check error message for authentication/validation errors
    const message = error.message || ''
    if (message.includes('邮箱或密码错误') || 
        message.includes('密码错误') ||
        message.includes('认证失败') ||
        message.includes('密码错误次数过多') ||
        message.includes('密码必须') ||
        message.includes('必须大于') ||
        message.includes('验证失败') ||
        message.includes('The GET method is not supported') ||
        message.includes('The POST method is not supported')) {
      return true
    }
    
    // Network errors mean server is not reachable
    return false
  }

  /**
   * Check if error should not be retried (validation errors, auth errors, etc.)
   * Returns true if error should not be retried
   */
  private static shouldNotRetry(error: any): boolean {
    // If we got a response from server, check the status
    if (error.response) {
      const status = error.response.status
      // 4xx errors (except 408 timeout) should not be retried
      if (status >= 400 && status < 500 && status !== 408) {
        return true
      }
    }
    
    // Check error message for validation/auth errors that shouldn't be retried
    const message = error.message || ''
    if (message.includes('邮箱或密码错误') || 
        message.includes('密码错误') ||
        message.includes('认证失败') ||
        message.includes('密码错误次数过多') ||
        message.includes('密码必须') ||
        message.includes('必须大于') ||
        message.includes('验证失败') ||
        message.includes('The GET method is not supported') ||
        message.includes('The POST method is not supported')) {
      return true
    }
    
    return false
  }

  /**
   * Try to login using multiple domains until one succeeds
   * @param loginData Login credentials
   * @param preferredDomain Optional preferred domain to try first
   * @returns Object with token and the baseURL that worked
   */
  static async loginWithDomainFallback(
    loginData: LoginRequest,
    preferredDomain?: string
  ): Promise<{ token: string; baseURL: string }> {
    const domainsToTry = preferredDomain 
      ? [preferredDomain, ...XBOARD_SERVER_DOMAINS.filter(d => d !== preferredDomain)]
      : XBOARD_SERVER_DOMAINS

    let lastError: Error | null = null

    for (const domain of domainsToTry) {
      try {
        console.log(`[XboardClient] Attempting login to: ${domain}`)
        const client = new XboardClient(domain)
        
        // Try login with shorter timeout for domain checking
        const token = await client.login(loginData)
        
        console.log(`[XboardClient] Login successful on domain: ${domain}`)
        return { token, baseURL: domain }
      } catch (error: any) {
        lastError = error
        console.log(`[XboardClient] Login failed on ${domain}:`, error.message)
        
        // If server is reachable (got response or auth error), don't try other domains
        // This means the server is reachable but credentials are wrong or API mismatch
        if (this.isServerReachable(error)) {
          console.log(`[XboardClient] Server ${domain} is reachable, stopping domain fallback`)
          throw error
        }
        
        // Continue to next domain only for network errors
        console.log(`[XboardClient] Network error on ${domain}, trying next domain...`)
        continue
      }
    }

    // If we get here, all domains failed with network errors
    throw lastError || new Error('无法连接到任何服务器。请检查网络连接。')
  }

  /**
   * Execute a function with domain fallback for unauthenticated requests
   * @param operation Function that takes a baseURL and returns a result
   * @param preferredDomain Optional preferred domain to try first
   * @returns The result from the first successful domain
   */
  static async executeWithDomainFallback<T>(
    operation: (baseURL: string) => Promise<T>,
    preferredDomain?: string
  ): Promise<{ result: T; baseURL: string }> {
    const domainsToTry = preferredDomain 
      ? [preferredDomain, ...XBOARD_SERVER_DOMAINS.filter(d => d !== preferredDomain)]
      : XBOARD_SERVER_DOMAINS

    let lastError: Error | null = null

    for (const domain of domainsToTry) {
      try {
        console.log(`[XboardClient] Trying operation on: ${domain}`)
        const result = await operation(domain)
        console.log(`[XboardClient] Operation successful on domain: ${domain}`)
        return { result, baseURL: domain }
      } catch (error: any) {
        lastError = error
        console.log(`[XboardClient] Operation failed on ${domain}:`, error.message)
        
        // Continue to next domain for network errors
        continue
      }
    }

    // If we get here, all domains failed
    throw lastError || new Error('无法连接到任何服务器。请检查网络连接。')
  }

  /**
   * Retry wrapper for HTTP requests with exponential backoff
   */
  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    operation: string,
    retries: number = this.maxRetries
  ): Promise<T> {
    let lastError: any
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1) // Exponential backoff
          console.log(`[XboardClient] ${operation} attempt ${attempt + 1}/${retries + 1}, retrying in ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        
        return await requestFn()
      } catch (error: any) {
        lastError = error
        
        // Don't retry on validation/auth errors or client errors
        if (XboardClient.shouldNotRetry(error)) {
          console.log(`[XboardClient] ${operation} failed with non-retryable error, stopping immediately`)
          throw error
        }
        
        // Don't retry on authentication errors (4xx except network errors)
        if (error.response?.status >= 400 && error.response?.status < 500 && 
            error.code !== 'ECONNABORTED' && error.code !== 'ETIMEDOUT' && 
            error.code !== 'ENOTFOUND' && error.code !== 'ECONNREFUSED') {
          console.log(`[XboardClient] ${operation} failed with client error (${error.response?.status}), not retrying`)
          throw error
        }
        
        // Don't retry on last attempt
        if (attempt === retries) {
          break
        }
        
        console.log(`[XboardClient] ${operation} attempt ${attempt + 1} failed:`, error.message || error.code)
      }
    }
    
    // Enhance error message with network diagnostics
    const enhancedError = this.enhanceError(lastError, operation)
    throw enhancedError
  }

  /**
   * Enhance error messages with network diagnostics
   * Returns Chinese-only error messages without technical details
   */
  private enhanceError(error: any, operation: string): Error {
    // Extract Chinese message from response, or use default Chinese message
    let message = error.response?.data?.message || ''
    
    // If message contains English technical terms, replace with Chinese
    if (!message || message.includes('failed') || message.includes('error') || message.includes('status')) {
      // Map operation names to Chinese
      const operationMap: Record<string, string> = {
        'Login': '登录',
        'GetSubscribe': '获取订阅',
        'GetUserInfo': '获取用户信息',
        'SendEmailVerify': '发送验证码',
        'Register': '注册',
        'ResetPassword': '重置密码'
      }
      const operationName = operationMap[operation] || '操作'
      message = message || `${operationName}失败`
    }
    
    // Remove English technical details from message
    message = message.replace(/status \d+/gi, '')
    message = message.replace(/ECONNABORTED|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ENETUNREACH/gi, '')
    message = message.replace(/GET method|POST method|not supported/gi, '')
    message = message.trim()
    
    let details = ''
    
    // Network-level errors - only show Chinese messages
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      details = '连接超时。请检查：\n1. 网络连接是否正常\n2. 防火墙是否阻止了连接\n3. 是否使用了代理（可能需要先配置系统代理）'
      message = message || '连接超时'
    } else if (error.code === 'ENOTFOUND') {
      details = 'DNS 解析失败。请检查：\n1. DNS 设置是否正确\n2. 网络连接是否正常\n3. 是否可以访问其他网站'
      message = message || 'DNS 解析失败'
    } else if (error.code === 'ECONNREFUSED') {
      details = '连接被拒绝。服务器可能暂时不可用，请稍后重试。'
      message = message || '连接被拒绝'
    } else if (error.code === 'ENETUNREACH') {
      details = '网络不可达。请检查网络连接。'
      message = message || '网络不可达'
    } else if (error.response?.status === 0) {
      details = '无法连接到服务器。请检查：\n1. 网络连接是否正常\n2. 服务器地址是否正确\n3. 是否需要使用代理'
      message = message || '无法连接到服务器'
    }
    
    // HTTP status errors - only show Chinese messages
    if (error.response?.status >= 500) {
      details = '服务器错误。服务器可能暂时不可用，请稍后重试。'
      message = message || '服务器错误'
    } else if (error.response?.status === 403) {
      details = '访问被拒绝。请检查账户权限。'
      message = message || '访问被拒绝'
    } else if (error.response?.status === 401) {
      details = '认证失败。请检查用户名和密码。'
      message = message || '认证失败'
    }
    
    // Clean up message - remove any remaining English
    message = message.replace(/Login failed|Failed to|error|Error/gi, '').trim()
    if (!message) {
      message = '操作失败'
    }
    
    if (details) {
      message = `${message}\n\n${details}`
    }
    
    const enhancedError = new Error(message)
    enhancedError.stack = error.stack
    return enhancedError
  }

  setAuthToken(token: string): void {
    this.http.defaults.headers.common['Authorization'] = token
    console.log('[XboardClient] Set auth token to:', token.substring(0, 20) + '...')
  }

  clearAuth(): void {
    delete this.http.defaults.headers.common['Authorization']
  }

  async login(data: LoginRequest): Promise<string> {
    try {
      console.log('[XboardClient] Attempting login to:', this.baseURL)
      const response = await this.http.post<LoginResponse>('/api/v1/passport/auth/login', data)
      
      console.log('[XboardClient] Login response:', JSON.stringify(response.data, null, 2))
      
      // Check for validation/auth errors first - these should not be retried
      if (response.data?.status === 'fail' || response.data?.message) {
        const errorMessage = response.data.message || '登录失败'
        const error: any = new Error(errorMessage)
        error.response = response
        // If it's a validation/auth error, don't retry
        if (XboardClient.shouldNotRetry(error)) {
          throw error
        }
      }
      
      // Check for API-level errors
      if (response.status !== 200 || !response.data) {
        // Use Chinese message from response, or default Chinese message
        const errorMessage = response.data?.message || '登录失败'
        const error: any = new Error(errorMessage)
        error.response = response
        // If it's a validation/auth error, don't retry
        if (XboardClient.shouldNotRetry(error)) {
          throw error
        }
        throw error
      }
      
      if (response.data?.data?.token) {
        const token = response.data.data.token
        
        // Use auth_data if available (it's the full Bearer token)
        if (response.data.data.auth_data) {
          console.log('[XboardClient] Using auth_data as Bearer token')
          this.setAuthToken(response.data.data.auth_data)
          return response.data.data.auth_data
        }
        
        // Fallback to token if no auth_data
        console.log('[XboardClient] Got token:', token.substring(0, 20) + '...')
        this.setAuthToken(token)
        return token
      }
      
      throw new Error(response.data?.message || '登录响应无效：未收到令牌')
    } catch (error: any) {
      // If it's a validation/auth error, don't retry
      if (XboardClient.shouldNotRetry(error)) {
        throw error
      }
      
      // For network errors, use retry mechanism
      return this.retryRequest(async () => {
        const response = await this.http.post<LoginResponse>('/api/v1/passport/auth/login', data)
        
        if (response.status !== 200 || !response.data) {
          throw new Error(response.data?.message || '登录失败')
        }
        
        if (response.data?.data?.token) {
          const token = response.data.data.token
          if (response.data.data.auth_data) {
            this.setAuthToken(response.data.data.auth_data)
            return response.data.data.auth_data
          }
          this.setAuthToken(token)
          return token
        }
        
        throw new Error(response.data?.message || '登录响应无效：未收到令牌')
      }, 'Login')
    }
  }

  async getUserInfo(): Promise<UserInfo> {
    return this.retryRequest(async () => {
      console.log('[XboardClient] Getting user info, headers:', this.http.defaults.headers.common)
      const response = await this.http.get<{ data: UserInfo }>('/api/v1/user/info')
      console.log('[XboardClient] User info response:', JSON.stringify(response.data, null, 2))
      
      if (response.status !== 200 || !response.data?.data) {
        throw new Error(response.data?.message || '获取用户信息失败')
      }
      
      // Get subscribe info to get traffic usage (u, d, transfer_enable, expired_at)
      let subscribeData: any = {}
      try {
        const subscribeResponse = await this.http.get<{ data: any }>('/api/v1/user/getSubscribe')
        console.log('[XboardClient] Subscribe response (for traffic data):', JSON.stringify(subscribeResponse.data, null, 2))
        subscribeData = subscribeResponse.data.data
      } catch (e) {
        console.log('[XboardClient] Could not get subscribe data for traffic')
      }
      
      const userData = response.data.data
      console.log('[XboardClient] Full user data with plan:', JSON.stringify(userData, null, 2))
      
      // Step 1: Get plan_id from user info
      const planId = userData.plan_id
      let planName = userData.plan_name
      
      // Step 2: Try to fetch plan name from user plan list
      if (planId) {
        try {
          const planResponse = await this.http.get<{ data: any[] }>('/api/v1/user/plan/fetch')
          console.log('[XboardClient] Plan list response:', JSON.stringify(planResponse.data, null, 2))
          const plans = planResponse.data?.data || []
          const matchedPlan = plans.find((plan: any) => plan.id === planId)
          if (matchedPlan && matchedPlan.name) {
            planName = matchedPlan.name
            console.log(`[XboardClient] Found plan name: ${planName} for plan_id: ${planId}`)
          }
        } catch (e) {
          console.log('[XboardClient] Could not get plan list from user endpoint')
          
          // Step 3: Fallback to guest plan list
          try {
            const guestPlanResponse = await this.http.get<{ data: any[] }>('/api/v1/guest/plan/fetch')
            console.log('[XboardClient] Guest plan list response:', JSON.stringify(guestPlanResponse.data, null, 2))
            const plans = guestPlanResponse.data?.data || []
            const matchedPlan = plans.find((plan: any) => plan.id === planId)
            if (matchedPlan && matchedPlan.name) {
              planName = matchedPlan.name
              console.log(`[XboardClient] Found plan name from guest list: ${planName} for plan_id: ${planId}`)
            }
          } catch (guestErr) {
            console.log('[XboardClient] Could not get plan from guest list either')
          }
        }
      }
      
      // Fallback if no plan name found
      if (!planName && planId) {
        planName = `未知套餐（ID: ${planId}）`
      }
      
      // Merge traffic data from getSubscribe into user info
      return {
        ...userData,
        plan_name: planName,
        u: subscribeData.u,
        d: subscribeData.d,
        transfer_enable: subscribeData.transfer_enable || userData.transfer_enable,
        expired_at: subscribeData.expired_at || userData.expired_at
      }
    }, 'GetUserInfo')
  }

  async getSubscribe(): Promise<SubscribeInfo> {
    return this.retryRequest(async () => {
      console.log('[XboardClient] Getting subscribe, headers:', this.http.defaults.headers.common)
      const response = await this.http.get<{ data: SubscribeInfo }>('/api/v1/user/getSubscribe')
      console.log('[XboardClient] Subscribe response:', JSON.stringify(response.data, null, 2))
      
      if (response.status !== 200 || !response.data?.data) {
        throw new Error(response.data?.message || '获取订阅信息失败')
      }
      
      return response.data.data
    }, 'GetSubscribe')
  }

  /**
   * Get subscribe info with domain fallback
   * @param token Authentication token
   * @param preferredDomain Optional preferred domain to try first
   * @returns Subscribe info and the baseURL that worked
   */
  static async getSubscribeWithDomainFallback(
    token: string,
    preferredDomain?: string
  ): Promise<{ subscribe: SubscribeInfo; baseURL: string }> {
    const domainsToTry = preferredDomain 
      ? [preferredDomain, ...XBOARD_SERVER_DOMAINS.filter(d => d !== preferredDomain)]
      : XBOARD_SERVER_DOMAINS

    let lastError: Error | null = null

    for (const domain of domainsToTry) {
      try {
        console.log(`[XboardClient] Attempting to get subscribe from: ${domain}`)
        const client = new XboardClient(domain)
        client.setAuthToken(token)
        
        const subscribe = await client.getSubscribe()
        
        console.log(`[XboardClient] Get subscribe successful on domain: ${domain}`)
        return { subscribe, baseURL: domain }
      } catch (error: any) {
        lastError = error
        console.log(`[XboardClient] Get subscribe failed on ${domain}:`, error.message)
        
        // If server is reachable (got response or auth error), don't try other domains
        if (this.isServerReachable(error)) {
          console.log(`[XboardClient] Server ${domain} is reachable, stopping domain fallback`)
          throw error
        }
        
        // Continue to next domain only for network errors
        console.log(`[XboardClient] Network error on ${domain}, trying next domain...`)
        continue
      }
    }

    // If we get here, all domains failed with network errors
    throw lastError || new Error('无法连接到任何服务器获取订阅信息。请检查网络连接。')
  }

  async logout(): Promise<void> {
    try {
      await this.http.post('/api/v1/user/logout')
    } catch (error: any) {
      // Ignore logout errors
      console.error('Logout error:', error)
    } finally {
      this.clearAuth()
    }
  }

  async getAnnouncements(): Promise<Array<{ id: number; title: string; content: string; created_at: number }>> {
    try {
      console.log('[XboardClient] Getting announcements from /api/v1/user/notice/fetch')
      const response = await this.http.get<{ data: Array<{ id: number; title: string; content: string; created_at: number }>, total: number }>('/api/v1/user/notice/fetch')
      console.log('[XboardClient] Announcements response status:', response.status)
      console.log('[XboardClient] Full response:', JSON.stringify(response.data, null, 2))
      
      // According to API docs, response has { data: [...], total: N }
      if (response.data?.data && Array.isArray(response.data.data)) {
        console.log('[XboardClient] Found', response.data.data.length, 'announcements')
        return response.data.data
      }
      
      console.warn('[XboardClient] Unexpected response structure')
      return []
    } catch (error: any) {
      console.error('[XboardClient] Get announcements error:', error.response?.status, error.response?.data || error.message)
      // Return empty array on error instead of throwing
      return []
    }
  }

  async sendEmailVerify(email: string): Promise<boolean> {
    try {
      console.log('[XboardClient] Sending email verification code to:', email)
      const response = await this.http.post('/api/v1/passport/comm/sendEmailVerify', { email })
      console.log('[XboardClient] Send email verify response:', JSON.stringify(response.data, null, 2))
      
      // Check for success indicators
      if (response.status === 200 && response.data?.message) {
        console.log('[XboardClient] Email verification code sent successfully')
        return true
      }
      
      throw new Error(response.data?.message || '发送验证码失败')
    } catch (error: any) {
      console.error('[XboardClient] Send email verify error:', error.response?.status, error.response?.data || error.message)
      const message = error.response?.data?.message || '发送验证码失败'
      throw new Error(message)
    }
  }

  async register(data: { email: string; password: string; password_confirm: string; email_code: string; invite_code?: string }): Promise<boolean> {
    try {
      console.log('[XboardClient] Registering user:', data.email)
      const response = await this.http.post('/api/v1/passport/auth/register', data)
      console.log('[XboardClient] Register response:', JSON.stringify(response.data, null, 2))
      
      // Check for success indicators
      if (response.status === 200 && response.data?.data) {
        console.log('[XboardClient] Registration successful')
        return true
      }
      
      throw new Error(response.data?.message || '注册失败')
    } catch (error: any) {
      console.error('[XboardClient] Register error:', error.response?.status, error.response?.data || error.message)
      const message = error.response?.data?.message || '注册失败'
      throw new Error(message)
    }
  }

  async resetPassword(data: { email: string; email_code: string; password: string; password_confirm: string }): Promise<boolean> {
    try {
      console.log('[XboardClient] Resetting password for:', data.email)
      const response = await this.http.post('/api/v1/passport/auth/forget', data)
      console.log('[XboardClient] Reset password response:', JSON.stringify(response.data, null, 2))
      
      // Check for success indicators
      if (response.status === 200 && response.data?.data) {
        console.log('[XboardClient] Password reset successful')
        return true
      }
      
      throw new Error(response.data?.message || '重置密码失败')
    } catch (error: any) {
      console.error('[XboardClient] Reset password error:', error.response?.status, error.response?.data || error.message)
      const message = error.response?.data?.message || '重置密码失败'
      throw new Error(message)
    }
  }
}

