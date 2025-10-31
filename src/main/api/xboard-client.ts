import axios, { AxiosInstance } from 'axios'
import type { LoginRequest, LoginResponse, UserInfo, SubscribeInfo, AuthError } from '../../../shared/types/xboard'

export class XboardClient {
  private baseURL: string
  private http: AxiosInstance

  constructor(baseURL: string) {
    this.baseURL = baseURL.replace(/\/$/, '') // Remove trailing slash
    this.http = axios.create({
      baseURL: this.baseURL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      validateStatus: () => true // Accept all status codes
    })
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
      
      throw new Error('Invalid login response: no token received')
    } catch (error: any) {
      console.error('[XboardClient] Login error:', error.response?.data || error.message)
      const message = error.response?.data?.message || error.message || 'Login failed'
      throw new Error(message)
    }
  }

  async getUserInfo(): Promise<UserInfo> {
    try {
      console.log('[XboardClient] Getting user info, headers:', this.http.defaults.headers.common)
      const response = await this.http.get<{ data: UserInfo }>('/api/v1/user/info')
      console.log('[XboardClient] User info response:', JSON.stringify(response.data, null, 2))
      
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
    } catch (error: any) {
      console.error('[XboardClient] Get user info error:', error.response?.status, error.response?.data || error.message)
      const message = error.response?.data?.message || error.message || 'Failed to get user info'
      throw new Error(message)
    }
  }

  async getSubscribe(): Promise<SubscribeInfo> {
    try {
      console.log('[XboardClient] Getting subscribe, headers:', this.http.defaults.headers.common)
      const response = await this.http.get<{ data: SubscribeInfo }>('/api/v1/user/getSubscribe')
      console.log('[XboardClient] Subscribe response:', JSON.stringify(response.data, null, 2))
      return response.data.data
    } catch (error: any) {
      console.error('[XboardClient] Get subscribe error:', error.response?.status, error.response?.data || error.message)
      const message = error.response?.data?.message || error.message || 'Failed to get subscribe'
      throw new Error(message)
    }
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
      
      throw new Error(response.data?.message || 'Failed to send verification code')
    } catch (error: any) {
      console.error('[XboardClient] Send email verify error:', error.response?.status, error.response?.data || error.message)
      const message = error.response?.data?.message || error.message || 'Failed to send verification code'
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
      
      throw new Error(response.data?.message || 'Registration failed')
    } catch (error: any) {
      console.error('[XboardClient] Register error:', error.response?.status, error.response?.data || error.message)
      const message = error.response?.data?.message || error.message || 'Registration failed'
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
      
      throw new Error(response.data?.message || 'Password reset failed')
    } catch (error: any) {
      console.error('[XboardClient] Reset password error:', error.response?.status, error.response?.data || error.message)
      const message = error.response?.data?.message || error.message || 'Password reset failed'
      throw new Error(message)
    }
  }
}

