# Xboard/V2Board API 集成信息

## 后端系统

项目基于：
- **Xboard**: https://github.com/cedar2025/Xboard
- **V2Board**: https://github.com/v2board/v2board

Xboard 与 V2Board 完全兼容，API 协议相同。

## API 文档参考

**官方文档**: https://github.com/cdnf/v2board-api-document

## 核心 API 端点

### 1. 登录 (Passport Auth)
```
POST /api/v1/passport/auth/login
Content-Type: application/json
Body: {
  "email": "user@example.com",
  "password": "password123"
}

Response: {
  "data": {
    "token": "xxx-token-xxx",
    "auth_data": "..."
  }
}
```

### 2. 获取用户信息
```
GET /api/v1/user/info
Authorization: Bearer {token}
```

### 3. 获取订阅
```
GET /api/v1/user/getSubscribe
Authorization: Bearer {token}
Response: {
  "data": {
    "subscribe_url": "https://...",
    "token": "..."
  }
}
```

### 4. 登出
```
POST /api/v1/user/logout
Authorization: Bearer {token}
```

## 认证方式

所有需要认证的 API 都需要在 Header 中携带：
```
Authorization: Bearer {token}
```

## 注意事项

1. **Token 有效期**: Token 通常有时间限制，需要处理过期情况
2. **Base URL**: 需要配置完整的面板地址，如 `https://panel.example.com`
3. **Content-Type**: 所有请求都需要设置 `Content-Type: application/json`
4. **订阅 URL**: 获取的订阅 URL 可以附加参数，如 `?flag=clash` 或 `?flag=meta`

## 订阅格式支持

- `?flag=clash` - Clash 格式
- `?flag=meta` - Clash Meta 格式
- `?flag=shadowrocket` - Shadowrocket 格式
- `?flag=v2ray` - V2Ray 格式

## 实现建议

参考之前实现的 `PanelClient` 类：
- 支持多端点自动尝试
- Cookie 认证支持
- 错误处理和日志

## 测试面板

如果遇到认证问题，可以检查：
1. API 文档版本
2. 面板具体使用的认证机制
3. 是否需要 Cookie 或 Session


