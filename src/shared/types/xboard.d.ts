// Xboard/V2Board API Types

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  data: {
    token: string
    auth_data: string  // This is the actual Bearer token to use
    [key: string]: unknown
  }
}

export interface UserInfo {
  email: string
  plan_id?: number
  plan_name?: string  // 套餐名称
  plan?: {  // 套餐对象
    name?: string
    id?: number
    transfer_enable?: number
    expired_at?: number
    [key: string]: unknown
  }
  discount?: number
  commission_rate?: number
  total_used?: number  // 总使用流量
  total_available?: number
  expired_at?: number
  u?: number  // 上行流量
  d?: number  // 下行流量
  transfer_enable?: number  // 总流量限额
  [key: string]: unknown
}

export interface SubscribeInfo {
  subscribe_url: string
  subscribe_url_token?: string
  [key: string]: unknown
}

export interface AuthError {
  message: string
  status?: number
}

