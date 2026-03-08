<div align="center">

# Claude Code Hub - Quota Monitor

**[Claude-Code-Hub](https://github.com/ding113/claude-code-hub) 的配额监控面板：统一查看余额、签到、可视化**

[![Container Image](https://img.shields.io/badge/ghcr.io-hashmapw%2Fclaude--code--hub--quota--monitor-181717?logo=github)](https://github.com/hashmapw/claude-code-hub-quota-monitor/pkgs/container/claude-code-hub-quota-monitor)
[![License](https://img.shields.io/github/license/hashmapw/claude-code-hub-quota-monitor)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/hashmapw/claude-code-hub-quota-monitor)](https://github.com/hashmapw/claude-code-hub-quota-monitor/stargazers)

</div>

---

## 📖 目录

- 💡 [30 秒看懂](#-30-秒看懂)
- ✨ [功能清单](#-功能清单)
- 🖼️ [界面预览](#-界面预览)
- ⚡ [快速开始](#-快速开始)
- 📋 [第一次配置](#-第一次配置按顺序做)
- 🧩 [类型定义](#-类型定义)
- 🔄 [自动恢复机制](#-自动恢复机制)
- ⚙️ [环境变量](#-环境变量)
- 🐳 [Docker 多平台构建](#-docker-多平台构建)
- ❓ [常见问题](#-常见问题)
- 🛠️ [二次开发](#-二次开发)
- 🏗️ [技术栈](#-技术栈)
- 📊 [核心数据流](#-核心数据流)
- 📁 [目录结构](#-目录结构)

---

## 💡 30 秒看懂

| 职责 | 项目 |
|------|------|
| API 转发 / 调度 / 负载均衡 | [claude-code-hub](https://github.com/ding113/claude-code-hub) |
| 余额监控 / 签到 / 可视化 | **claude-code-quota-monitor**（本项目） |

本项目读取 claude-code-hub 的 PostgreSQL `providers` 表，按你定义的"类型规则"查询各端点额度、用量、签到状态，并展示在一个统一控制台里。

核心解决 4 件事：

1. **统一看余额**：不再每家站点单独登录查询
2. **自定义查询规则**：类型定义可导入/导出，社区共享
3. **自动化运维**：每日签到、定时刷新、余额趋势追踪
4. **自动恢复**：401 自动刷新 Token、403 自动破解挑战页、失败保留最后有效数据

---

## ✨ 功能清单

- **控制台**：端点余额总览、按服务商分组、搜索过滤、一键刷新
- **类型定义管理**：Monaco 编辑器在线编辑规则，支持 JSON 导入导出，社区快速支持不同类型的供应商
- **每日签到**：按服务商执行 checkin，带历史记录和奖励统计
- **余额趋势**：支持 6h / 24h / 3d / 7d / 30d / 90d 时间范围的余额变化图表
- **系统设置**：代理、自动刷新间隔、定时签到、并发控制
- **调试页**：每次查询的请求链路和响应摘要，快速定位问题
- **管理员认证**：密码登录 + Session 管理，保护面板安全
- **暗色模式**：跟随系统或手动切换
- **自动恢复**：401 Token 刷新 / 403 ACW 挑战破解 / StaleLock 过期保护

---

## 🖼️ 界面预览

| 功能 | 浅色 | 深色 |
|------|------|------|
| 登录页 | ![登录页-浅色](public/readme/login-light.png) | ![登录页-深色](public/readme/login-dark.png) |
| 控制台 | ![控制台-浅色](public/readme/dashboard-light.png) | ![控制台-深色](public/readme/dashboard-dark.png) |
| 类型管理 | ![类型管理-浅色](public/readme/vendor-definitions-light.png) | ![类型管理-深色](public/readme/vendor-definitions-dark.png) |
| 余额趋势 | ![余额趋势-浅色](public/readme/balance-history-light.png) | ![余额趋势-深色](public/readme/balance-history-dark.png) |
| 每日签到 | ![每日签到-浅色](public/readme/daily-checkin-light.png) | ![每日签到-深色](public/readme/daily-checkin-dark.png) |
| 系统设置 | ![系统设置-浅色](public/readme/settings-light.png) | ![系统设置-深色](public/readme/settings-dark.png) |

---

## ⚡ 快速开始

### 方式一：Docker Compose（推荐）

**1) 准备配置**

```bash
git clone https://github.com/hashmapw/claude-code-hub-quota-monitor.git
cd claude-code-hub-quota-monitor
cp .env.example .env
```

编辑 `.env`，**必须修改**：

```bash
# 必填：连接 claude-code-hub 的 PostgreSQL
MONITOR_DSN=postgresql://user:password@host:5432/claude_code_hub

# 必填：管理员登录密码（不支持 sk- 开头）
MONITOR_ADMIN_PASSWORD=your-secure-password
```

**2) 启动**

```bash
docker compose --env-file .env up -d
```

> 默认拉取 ghcr.io 上的预构建镜像。如需从源码构建，先安装 Node.js 22+ 并执行 `npm install && npm run build`，再运行 `docker compose --env-file .env up -d --build`。

**3) 访问**

打开 `http://localhost:23010`，使用设置的管理员密码登录。

<details>
<summary>自定义端口和绑定地址</summary>

在 `.env` 中修改：

```bash
HOST_BIND_IP=0.0.0.0       # 绑定地址，默认 127.0.0.1
HOST_PORT=23010            # 主机端口，默认 23010
CONTAINER_PORT=3010        # 容器端口，默认 3010
```

</details>

<details>
<summary>使用主机目录挂载数据</summary>

默认使用 Docker named volume（`app-data`）。如需改为主机目录：

```bash
# .env
DATA_SOURCE=/home/ubuntu/claude-quota-monitor-data
```

提前创建目录并设置权限：

```bash
sudo mkdir -p /home/ubuntu/claude-quota-monitor-data
sudo chown 1001:1001 /home/ubuntu/claude-quota-monitor-data
```

</details>

---

### 方式二：本地开发

> 需要 Node.js 22+

```bash
git clone https://github.com/hashmapw/claude-code-hub-quota-monitor.git
cd claude-code-hub-quota-monitor
npm install
cp .env.example .env
```

编辑 `.env`：

```bash
MONITOR_DSN=postgresql://user:password@localhost:5432/claude_code_hub
MONITOR_ADMIN_PASSWORD=your-secure-password
```

启动：

```bash
npm run dev
```

打开 `http://localhost:3010`。

> 如果你和 `claude-code-hub` 在同级目录，且 `../claude-code-hub/.env` 里有 `DSN`，`MONITOR_DSN` 可以不填，项目会自动探测。

---

## 📋 第一次配置（按顺序做）

1. **确认数据库连通**：启动后首页能看到端点列表（状态为"未检查"是正常的）
2. **导入类型定义**：去 **类型管理** 页面，导入对应站点的 JSON 规则（参考[类型定义](#类型定义)）
3. **配置认证**：在控制台点击对应端点进入设置页，按站点要求填写 API Key / Cookie / AccessToken
4. **刷新验证**：回首页点"刷新"，状态显示 `ok` 即链路通了

> 建议先拿 1 个端点测通，再批量铺开。

---

## 🧩 类型定义

在 **类型管理** 页面导入对应 JSON 即可使用。如果你的站点不在列表中，参考[适配新站点](#适配新站点)章节自行创建。

### NewAPI类
![NewAPI](public/readme/NewAPI.png)
适用于 NewAPI 原生架构站点。配置 `New_API_User` 和 `Access_Token` 即可完成余额查询、每日签到等全部操作；可选配置 `Cookie` 作为备用鉴权方式。个别站点可能对签到接口或返回字段有自定义修改，请以实际响应为准。

<details>
<summary>NewAPI类型定义JSON</summary>

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-03-08T09:56:32.827Z",
  "source": "vendor-definitions-board",
  "definition": {
    "vendorType": "newapi",
    "displayName": "NewAPI",
    "description": "兼容 NewAPI 原生接口架构的站点。支持通过系统访问令牌 (Access Token) 或浏览器 Cookie 提取账户余额信息。",
    "regionConfig": {
      "version": 1,
      "endpointTotalMode": "sum_from_parts",
      "refreshTokenEnabled": false,
      "refreshToken": {
        "auth": "bearer",
        "method": "POST",
        "path": "/api/auth/refresh",
        "queryParams": {},
        "requestHeaders": {},
        "requestBody": {
          "refresh_token": "$cookieValue"
        },
        "autoHandle403Intercept": true,
        "refreshOnUnauth": true,
        "refreshResponseMappings": [
          {
            "field": "access_token",
            "envVarKey": "AccessToken",
            "formula": {
              "type": "direct"
            }
          },
          {
            "field": "refresh_token",
            "envVarKey": "RefreshToken",
            "formula": {
              "type": "direct"
            }
          }
        ]
      },
      "dailyCheckinEnabled": true,
      "dailyCheckin": {
        "auth": "bearer",
        "method": "POST",
        "path": "/api/user/checkin",
        "queryParams": {},
        "requestHeaders": {
          "New-API-User": "$New_API_User",
          "Authorization": "Bearer $Access_Token"
        },
        "requestBody": {},
        "autoHandle403Intercept": true,
        "dateField": "data.checkin_date",
        "awardedField": "data.quota_awarded",
        "awardedFormula": {
          "type": "divide",
          "divisor": 500000
        }
      },
      "endpointMetricModes": {
        "endpoint_remaining": "independent_request",
        "endpoint_used": "independent_request"
      },
      "aggregation": {
        "vendor_remaining": "independent_request",
        "vendor_used": "independent_request"
      },
      "regions": {
        "vendor_remaining": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/user/self",
          "queryParams": {},
          "requestHeaders": {
            "Authorization": "Bearer $Access_Token",
            "New-API-User": "$New_API_User",
            "Cookie": "$Cookie"
          },
          "autoHandle403Intercept": true,
          "field": "data.quota",
          "formula": {
            "type": "divide",
            "divisor": 500000
          }
        },
        "vendor_used": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/user/self",
          "requestHeaders": {
            "Authorization": "Bearer $Access_Token",
            "New-API-User": "$New_API_User",
            "Cookie": "$Cookie"
          },
          "autoHandle403Intercept": true,
          "field": "data.used_quota",
          "formula": {
            "type": "divide",
            "divisor": 500000
          }
        },
        "endpoint_remaining": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/user/self",
          "queryParams": {},
          "requestHeaders": {
            "Authorization": "Bearer $Access_Token",
            "New-API-User": "$New_API_User",
            "Cookie": "$Cookie"
          },
          "autoHandle403Intercept": true,
          "field": "data.quota",
          "formula": {
            "type": "divide",
            "divisor": 500000
          }
        },
        "endpoint_used": {
          "auth": "bearer",
          "method": "GET",
          "path": "/v1/dashboard/billing/usage",
          "queryParams": {
            "start_date": "$todayDate",
            "end_date": "$tomorrowDate"
          },
          "requestHeaders": {
            "Authorization": "Bearer $apiKey"
          },
          "autoHandle403Intercept": true,
          "field": "total_usage",
          "formula": {
            "type": "divide",
            "divisor": 100
          }
        },
        "endpoint_total": {
          "auth": "bearer",
          "method": "GET",
          "path": "/v1/dashboard/billing/usage",
          "autoHandle403Intercept": true,
          "field": null,
          "formula": null
        }
      },
      "middle": {
        "mode": "token_usage",
        "token_usage": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/usage/token/",
          "queryParams": {},
          "requestHeaders": {
            "Authorization": "Bearer $apiKey"
          },
          "requestBody": {},
          "autoHandle403Intercept": true,
          "usedField": "data.total_used",
          "remainingField": "data.total_available",
          "usedFormula": null,
          "remainingFormula": null
        },
        "reset_date": null
      }
    },
    "envVars": [
      {
        "key": "New_API_User",
        "label": "用户账户 ID",
        "scope": "vendor",
        "meaning": "用于精准定位用户数据的标识 ID，请在平台的【个人设置 -> 账户信息】页面中复制。",
        "optional": false,
        "defaultValue": null
      },
      {
        "key": "Access_Token",
        "label": "系统访问令牌 (Access Token)",
        "scope": "vendor",
        "meaning": "通过调用平台原生 API 的核心鉴权凭据，请在【安全设置 / 账户管理】页面中生成并添加。",
        "optional": false,
        "defaultValue": null
      },
      {
        "key": "Cookie",
        "label": "浏览器登录会话 (Cookie)",
        "scope": "vendor",
        "meaning": "(备用方案) 在浏览器按 F12 打开网络面板，复制任意系统接口请求头中的 Cookie 字段值。",
        "optional": true,
        "defaultValue": "NULL"
      }
    ]
  }
}
```

</details>


### Sub2API类
![Sub2API](public/readme/Sub2API.png)
适用于 Sub2API V1 版本接口的站点。配置 `JwtToken` 即可完成额度查询。当 Token 过期时，系统自动使用预存的账号密码重新登录并获取新 Token，无需手动干预。

<details>
<summary>Sub2Api类型定义JSON</summary>

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-03-08T10:02:32.749Z",
  "source": "vendor-definitions-board",
  "definition": {
    "vendorType": "sub2api-v1",
    "displayName": "Sub2Api-V1",
    "description": "Sub2Api 新版v1站点，通过 /api/v1/auth/me 查询每日额度",
    "regionConfig": {
      "version": 1,
      "endpointTotalMode": "independent_request",
      "refreshTokenEnabled": true,
      "refreshToken": {
        "auth": "bearer",
        "method": "POST",
        "path": "/api/v1/auth/login",
        "queryParams": {},
        "requestHeaders": {},
        "requestBody": {
          "email": "$Email",
          "password": "$PassWord"
        },
        "autoHandle403Intercept": true,
        "refreshOnUnauth": true,
        "refreshResponseMappings": [
          {
            "field": "data.access_token",
            "envVarKey": "JwtToken",
            "formula": {
              "type": "direct"
            }
          },
          {
            "field": "data.refresh_token",
            "envVarKey": "RefreshToken",
            "formula": {
              "type": "direct"
            }
          }
        ]
      },
      "dailyCheckinEnabled": false,
      "dailyCheckin": null,
      "endpointMetricModes": {
        "endpoint_remaining": "subtract_from_total",
        "endpoint_used": "independent_request"
      },
      "aggregation": {
        "vendor_remaining": "endpoint_sum",
        "vendor_used": "endpoint_sum"
      },
      "regions": {
        "vendor_remaining": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/auth/me",
          "autoHandle403Intercept": true,
          "refreshOnUnauth": true,
          "refreshPath": "/api/v1/auth/refresh",
          "refreshBodyTemplate": {
            "refresh_token": "$RefreshToken"
          },
          "refreshResponseMappings": [
            {
              "field": "data.access_token",
              "envVarKey": "JwtToken",
              "formula": {
                "type": "direct"
              }
            },
            {
              "field": "data.refresh_token",
              "envVarKey": "RefreshToken",
              "formula": {
                "type": "direct"
              }
            }
          ],
          "field": null,
          "formula": null
        },
        "vendor_used": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/auth/me",
          "autoHandle403Intercept": true,
          "refreshOnUnauth": true,
          "refreshPath": "/api/v1/auth/refresh",
          "refreshBodyTemplate": {
            "refresh_token": "$RefreshToken"
          },
          "refreshResponseMappings": [
            {
              "field": "data.access_token",
              "envVarKey": "JwtToken",
              "formula": {
                "type": "direct"
              }
            },
            {
              "field": "data.refresh_token",
              "envVarKey": "RefreshToken",
              "formula": {
                "type": "direct"
              }
            }
          ],
          "field": "daily_credit_used",
          "formula": {
            "type": "direct"
          }
        },
        "endpoint_remaining": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/auth/me",
          "requestHeaders": {
            "Authorization": "$JwtToken",
            "Refresh": "$RefreshToken"
          },
          "autoHandle403Intercept": true,
          "refreshOnUnauth": true,
          "refreshPath": "/api/v1/auth/refresh",
          "refreshBodyTemplate": {
            "refresh_token": "$RefreshToken"
          },
          "refreshResponseMappings": [
            {
              "field": "data.access_token",
              "envVarKey": "JwtToken",
              "formula": {
                "type": "direct"
              }
            },
            {
              "field": "data.refresh_token",
              "envVarKey": "RefreshToken",
              "formula": {
                "type": "direct"
              }
            }
          ],
          "field": null,
          "formula": null
        },
        "endpoint_used": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/v1/subscriptions/active",
          "requestHeaders": {
            "Authorization": "Bearer $JwtToken",
            "RefreshToken": "$RefreshToken"
          },
          "autoHandle403Intercept": true,
          "refreshOnUnauth": true,
          "refreshPath": "/api/v1/auth/refresh",
          "refreshBodyTemplate": {
            "refresh_token": "$RefreshToken"
          },
          "refreshResponseMappings": [
            {
              "field": "data.access_token",
              "envVarKey": "JwtToken",
              "formula": {
                "type": "direct"
              }
            },
            {
              "field": "data.refresh_token",
              "envVarKey": "RefreshToken",
              "formula": {
                "type": "direct"
              }
            }
          ],
          "field": "data.0.daily_usage_usd",
          "formula": {
            "type": "direct"
          }
        },
        "endpoint_total": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/v1/subscriptions/active",
          "requestHeaders": {
            "Authorization": "Bearer $JwtToken",
            "RefreshToken": "$RefreshToken"
          },
          "autoHandle403Intercept": true,
          "refreshOnUnauth": true,
          "refreshPath": "/api/v1/auth/refresh",
          "refreshBodyTemplate": {
            "refresh_token": "$RefreshToken"
          },
          "refreshResponseMappings": [
            {
              "field": "data.access_token",
              "envVarKey": "JwtToken",
              "formula": {
                "type": "direct"
              }
            },
            {
              "field": "data.refresh_token",
              "envVarKey": "RefreshToken",
              "formula": {
                "type": "direct"
              }
            }
          ],
          "field": "data.0.group.daily_limit_usd",
          "formula": {
            "type": "direct"
          }
        }
      },
      "middle": {
        "mode": "none",
        "token_usage": null,
        "reset_date": null
      }
    },
    "envVars": [
      {
        "key": "RefreshToken",
        "label": "刷新令牌",
        "scope": "endpoint",
        "meaning": "更新JwtToken刷新令牌，登录login接口返回值存在",
        "optional": false,
        "defaultValue": null
      },
      {
        "key": "JwtToken",
        "label": "JWT令牌",
        "scope": "endpoint",
        "meaning": "JwtToken认证令牌，登录login接口返回值存在",
        "optional": false,
        "defaultValue": null
      },
      {
        "key": "Email",
        "label": "登录邮箱",
        "scope": "endpoint",
        "meaning": "用于登录平台的邮箱",
        "optional": false,
        "defaultValue": null
      },
      {
        "key": "PassWord",
        "label": "登录密码",
        "scope": "endpoint",
        "meaning": "用于登录平台的密码",
        "optional": false,
        "defaultValue": null
      }
    ]
  }
}
```

</details>


### AnyRouter
![AnyRouter](public/readme/AnyRouter.png)
适用于 AnyRouter 等深度二次开发的 NewAPI 衍生站点。此类站点不支持生成 `Access_Token`，仅能通过 `New_API_User` + `Cookie` 进行会话级查询与签到（每 24 小时一次）。系统内置 403 JS 挑战自动破解，确保请求不被反爬机制拦截。

<details>
<summary>AnyRouter类型定义JSON</summary>

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-03-08T10:11:41.099Z",
  "source": "vendor-definitions-board",
  "definition": {
    "vendorType": "anyrouter",
    "displayName": "AnyRouter",
    "description": "类似 AnyRouter 等经过深度二次开发的 NewAPI 衍生站点。仅支持通过浏览器 Cookie 结合 New_API_User 进行会话级别的账户额度查询。",
    "regionConfig": {
      "version": 1,
      "endpointTotalMode": "sum_from_parts",
      "refreshTokenEnabled": false,
      "refreshToken": {
        "auth": "bearer",
        "method": "POST",
        "path": "/api/auth/refresh",
        "queryParams": {},
        "requestHeaders": {},
        "requestBody": {
          "refresh_token": "$cookieValue"
        },
        "autoHandle403Intercept": true,
        "refreshOnUnauth": true,
        "refreshResponseMappings": [
          {
            "field": "access_token",
            "envVarKey": "AccessToken",
            "formula": {
              "type": "direct"
            }
          },
          {
            "field": "refresh_token",
            "envVarKey": "RefreshToken",
            "formula": {
              "type": "direct"
            }
          }
        ]
      },
      "dailyCheckinEnabled": true,
      "dailyCheckin": {
        "auth": "bearer",
        "method": "POST",
        "path": "/api/user/sign_in",
        "queryParams": {},
        "requestHeaders": {
          "Cookie": "$Cookie"
        },
        "requestBody": {},
        "autoHandle403Intercept": true,
        "dateField": "message",
        "awardedField": "success",
        "awardedFormula": {
          "type": "divide",
          "divisor": 0.04
        }
      },
      "endpointMetricModes": {
        "endpoint_remaining": "independent_request",
        "endpoint_used": "independent_request"
      },
      "aggregation": {
        "vendor_remaining": "independent_request",
        "vendor_used": "independent_request"
      },
      "regions": {
        "vendor_remaining": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/user/self",
          "queryParams": {},
          "requestHeaders": {
            "New-API-User": "$New_API_User",
            "Cookie": "$Cookie"
          },
          "autoHandle403Intercept": true,
          "field": "data.quota",
          "formula": {
            "type": "divide",
            "divisor": 500000
          }
        },
        "vendor_used": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/user/self",
          "requestHeaders": {
            "New-API-User": "$New_API_User",
            "Cookie": "$Cookie"
          },
          "autoHandle403Intercept": true,
          "field": "data.used_quota",
          "formula": {
            "type": "divide",
            "divisor": 500000
          }
        },
        "endpoint_remaining": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/user/self",
          "queryParams": {},
          "requestHeaders": {
            "New-API-User": "$New_API_User",
            "Cookie": "$Cookie"
          },
          "autoHandle403Intercept": true,
          "field": "data.quota",
          "formula": {
            "type": "divide",
            "divisor": 500000
          }
        },
        "endpoint_used": {
          "auth": "bearer",
          "method": "GET",
          "path": "/v1/dashboard/billing/usage",
          "queryParams": {
            "start_date": "$todayDate",
            "end_date": "$tomorrowDate"
          },
          "requestHeaders": {
            "Authorization": "Bearer $apiKey"
          },
          "autoHandle403Intercept": true,
          "field": "total_usage",
          "formula": {
            "type": "divide",
            "divisor": 100
          }
        },
        "endpoint_total": {
          "auth": "bearer",
          "method": "GET",
          "path": "/v1/dashboard/billing/usage",
          "autoHandle403Intercept": true,
          "field": null,
          "formula": null
        }
      },
      "middle": {
        "mode": "token_usage",
        "token_usage": {
          "auth": "bearer",
          "method": "GET",
          "path": "/api/usage/token/",
          "queryParams": {},
          "requestHeaders": {
            "Authorization": "Bearer $apiKey"
          },
          "requestBody": {},
          "autoHandle403Intercept": true,
          "usedField": "data.total_used",
          "remainingField": "data.total_available",
          "usedFormula": null,
          "remainingFormula": null
        },
        "reset_date": null
      }
    },
    "envVars": [
      {
        "key": "New_API_User",
        "label": "用户账户 ID",
        "scope": "vendor",
        "meaning": "用于精准定位用户数据的标识 ID，请在平台的【个人设置】页面中找到。",
        "optional": false,
        "defaultValue": null
      },
      {
        "key": "Cookie",
        "label": "浏览器登录会话 (Cookie)",
        "scope": "vendor",
        "meaning": "在浏览器按 F12 打开网络面板，复制任意已登录接口请求头中的 Cookie 值作为鉴权凭据。",
        "optional": false,
        "defaultValue": null
      }
    ]
  }
}
```

</details>



### 88Code
![88Code](public/readme/88Code.png)
88Code 为独立架构的自建站点，接口规范与主流方案差异较大。当前仅需配置 `APIKey` 即可完成余额查询和额度重置（签到）操作。

> **注意：** 额度重置接口路径中包含套餐 ID（JSON 中 `dailyCheckin.path` 末尾的 `12345`），需替换为你的实际套餐 ID。可在请求详情的 `data.subscriptionEntityList.0.id` 字段中查看。

<details>
<summary>88Code类型定义JSON</summary>

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-03-08T10:21:35.444Z",
  "source": "vendor-definitions-board",
  "definition": {
    "vendorType": "88code",
    "displayName": "88Code",
    "description": "专用于 88Code 标准站点的额度计算，通过调用 /api/usage 接口直接精准提取并汇总所有可用与已用数据。",
    "regionConfig": {
      "version": 1,
      "endpointTotalMode": "independent_request",
      "refreshTokenEnabled": false,
      "refreshToken": {
        "auth": "bearer",
        "method": "POST",
        "path": "/api/auth/refresh",
        "queryParams": {},
        "requestHeaders": {},
        "requestBody": {
          "refresh_token": "$cookieValue"
        },
        "autoHandle403Intercept": true,
        "refreshResponseMappings": [
          {
            "field": "access_token",
            "envVarKey": "AccessToken",
            "formula": {
              "type": "direct"
            }
          },
          {
            "field": "refresh_token",
            "envVarKey": "RefreshToken",
            "formula": {
              "type": "direct"
            }
          }
        ]
      },
      "dailyCheckinEnabled": true,
      "dailyCheckin": {
        "auth": "bearer",
        "method": "POST",
        "path": "/api/reset-credits/12345",
        "queryParams": {},
        "requestHeaders": {
          "Authorization": "Bearer $apiKey"
        },
        "requestBody": {},
        "autoHandle403Intercept": true,
        "dateField": "code",
        "awardedField": "dataType",
        "awardedFormula": {
          "type": "divide",
          "divisor": 0.016666666666666666
        }
      },
      "endpointMetricModes": {
        "endpoint_remaining": "independent_request",
        "endpoint_used": "subtract_from_total"
      },
      "aggregation": {
        "vendor_remaining": "endpoint_sum",
        "vendor_used": "endpoint_sum"
      },
      "regions": {
        "vendor_remaining": {
          "auth": "bearer",
          "method": "POST",
          "path": "/api/usage",
          "autoHandle403Intercept": true,
          "field": "data.currentCredits",
          "formula": {
            "type": "direct"
          }
        },
        "vendor_used": {
          "auth": "bearer",
          "method": "POST",
          "path": "/api/usage",
          "autoHandle403Intercept": true,
          "field": null,
          "formula": null
        },
        "endpoint_remaining": {
          "auth": "bearer",
          "method": "POST",
          "path": "/api/usage",
          "requestHeaders": {
            "Authorization": "Bearer $apiKey"
          },
          "autoHandle403Intercept": true,
          "field": "data.subscriptionEntityList.0.currentCredits",
          "formula": {
            "type": "direct"
          }
        },
        "endpoint_used": {
          "auth": "bearer",
          "method": "POST",
          "path": "/api/usage",
          "requestHeaders": {
            "Authorization": "Bearer $apiKey"
          },
          "autoHandle403Intercept": true,
          "field": "data.totalCost",
          "formula": null
        },
        "endpoint_total": {
          "auth": "bearer",
          "method": "POST",
          "path": "/api/usage",
          "requestHeaders": {
            "Authorization": "Bearer $apiKey"
          },
          "autoHandle403Intercept": true,
          "field": "data.subscriptionEntityList.0.creditLimit",
          "formula": {
            "type": "direct"
          }
        }
      },
      "middle": {
        "mode": "reset_date",
        "token_usage": null,
        "reset_date": {
          "auth": "bearer",
          "method": "POST",
          "path": "/api/usage",
          "queryParams": {},
          "requestHeaders": {
            "Authorization": "Bearer $apiKey"
          },
          "requestBody": {},
          "autoHandle403Intercept": true,
          "resetField": "data.subscriptionEntityList.0.lastCreditReset"
        }
      }
    },
    "envVars": []
  }
}
```

</details>

###  适配新站点

1. 用浏览器 / curl 手动调用目标站点的余额接口，拿到真实 JSON 响应
2. 在 **类型管理** 页面新建类型，填写 `path` + `field` + `formula`
3. 绑定一个端点测试
4. 在调试页确认解析正确
5. 导出 JSON 分享给其他人复用或社区传播，欢迎提Pull Request和Issue给我们提供更多站点的支持

---

## 🔄 自动恢复机制

### 401：Token 过期自动刷新

当类型定义启用 `refreshTokenEnabled: true` 且配置了 `refreshToken`：

1. 查询遇到 401 → 自动调用 refresh 接口 → 持久化新凭证 → 重试原请求

### 403：反爬挑战自动破解

当响应命中 ACW 挑战特征：

1. 自动识别挑战页 → 自动求解生成 Cookie → 带新 Cookie 重试请求

### StaleLock：过期数据保护

刷新失败时不会清空余额，继续显示最后一次成功数据，并标记为过期状态。

---

## ⚙️ 环境变量

部署时只需关注以下两个必填项，其余均有合理默认值：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MONITOR_DSN` | 无 | claude-code-hub 的 PostgreSQL 连接串（**必填**） |
| `MONITOR_ADMIN_PASSWORD` | 无 | 管理员登录密码（**必填**，不支持 `sk-` 开头） |

其余可选变量按用途分组：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MONITOR_PROVIDER_SCHEMA` | `public` | 端点表 schema |
| `MONITOR_PROVIDER_TABLE` | `providers` | 端点表名 |
| `MONITOR_REDIS_URL` | 无 | Redis 地址，用于缓存查询结果 |
| `MONITOR_REDIS_TLS_REJECT_UNAUTHORIZED` | `true` | 是否验证 Redis TLS 证书 |
| `MONITOR_CACHE_TTL_MS` | `60000` | 内存缓存 TTL（毫秒） |
| `MONITOR_RESULT_CACHE_TTL_SEC` | `604800` | 结果缓存 TTL（秒，默认 7 天） |
| `MONITOR_PROXY_URL` | 无 | HTTP / HTTPS / SOCKS5 代理（也可在设置页配置） |
| `MONITOR_SETTINGS_DB_PATH` | 自动探测 | SQLite 配置库路径，不设则自动放在 `data/` 下 |
| `MONITOR_PROJECT_ROOT` | 自动探测 | 项目根目录，用于 SQLite 路径探测 |
| `MONITOR_DEBUG_HTTP` | `false` | 启用 HTTP 请求调试日志 |
| `PORT` | `3010` | 服务端口 |

> 部分变量支持从已有环境自动回退：`MONITOR_DSN` 回退 `DSN` → `DATABASE_URL` → `../claude-code-hub/.env`；`MONITOR_REDIS_URL` 回退 `REDIS_URL`；`MONITOR_PROXY_URL` 回退 `MONITOR_HTTP_PROXY` → `HTTPS_PROXY` → `HTTP_PROXY` → `ALL_PROXY`。

<details>
<summary>VS Code 远程开发相关变量</summary>

以下变量仅在 VS Code Remote / Codespaces 等远程开发环境下需要关注，普通部署无需配置：

| 变量 | 说明 |
|------|------|
| `VSCODE_PROXY_URI` | VS Code 代理 URI，用于资源路径前缀计算 |
| `VSCODE_URI` | VS Code 远程 URI，支持 `{{port}}` 占位符 |

</details>

---

## 🐳 Docker 多平台构建

如需构建 `linux/amd64` + `linux/arm64` 双平台镜像并推送：

```bash
# 先本地构建 standalone 产物
npm install && npm run build

# 创建 buildx builder（首次）
docker buildx create --name multiarch --use

# 构建并推送
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/hashmapw/claude-code-hub-quota-monitor:latest \
  --push .
```

> 构建前需要先执行 `npm run build`，因为 Dockerfile 依赖 `.next/standalone` 和 `.next/static` 产物。

---

## ❓ 常见问题

### 启动报"数据库连接串未配置"

- 补充 `MONITOR_DSN` 环境变量
- 或检查 `../claude-code-hub/.env` 是否有 `DSN`

### 页面看不到任何端点

- 检查 `MONITOR_DSN` 是否连到正确的数据库
- 检查 `providers` 表里是否有数据

### 全部显示"未检查"

- 还没有导入/创建类型定义（最常见原因）

### 状态 `unauthorized`

- Token / Cookie 失效或格式错误
- 去对应服务商设置页更新认证信息

### 状态 `parse_error`

- 返回了 HTML 而非 JSON
- 常见原因：登录页重定向 / 反爬拦截 / 代理异常

---

## 🛠️ 二次开发

```bash
npm run dev        # 本地开发（端口 3010）
npm run build      # 构建生产版本
npm run start      # 生产模式启动
npm run typecheck  # TypeScript 类型检查
```

---

## 🏗️ 技术栈

Next.js 16 / React 19 / TypeScript 5.9 / Tailwind 4 / PostgreSQL（读取 claude-code-hub 数据） / SQLite（本地配置） / Redis（可选缓存） / Monaco Editor / Recharts

---

## 📊 核心数据流

```
claude-code-hub PostgreSQL (providers)
  → db.ts 读取端点列表
  → vendor-settings / vendor-definitions (SQLite 配置)
  → config-engine 组装请求
  → adapters 执行查询并解析响应
  → cache / vendor-cache 缓存结果
  → API Routes + UI 页面展示
```

---

## 📁 目录结构

```
src/
  app/                          # 页面 + API Routes
    api/                        # 后端接口
      auth/                     #   认证（登录/登出）
      quotas/                   #   配额查询
      endpoints/                #   端点管理与刷新
      vendors/                  #   服务商配置
      vendor-definitions/       #   类型定义
      daily-checkin/            #   每日签到
      vendor-balance-history/   #   余额历史
      system-settings/          #   系统设置
    login/                      # 登录页
    settings/                   # 系统设置页
    daily-checkin/              # 每日签到页
    vendor-definitions/         # 类型管理页
    vendor-balance-history/     # 余额趋势页
    endpoints/[endpointId]/     # 端点设置 & 调试页
  components/                   # React UI 组件
  lib/                          # 业务逻辑
    db.ts                       #   读取 claude-code-hub PostgreSQL
    vendor-settings.ts          #   服务商/端点配置 (SQLite)
    vendor-definitions.ts       #   类型定义管理
    system-settings.ts          #   系统配置
    monitor-auth.ts             #   认证与会话
    quota/                      #   配额查询核心
      service.ts                #     业务编排
      config-engine.ts          #     请求组装引擎
      adapters.ts               #     查询适配层
      cache.ts                  #     Redis / 内存缓存
      vendor-cache.ts           #     服务商级聚合
data/                           # SQLite 数据库（运行时生成）
```

---

## 📜 License

MIT

[![Star History Chart](https://api.star-history.com/image?repos=Hashmapw/claude-code-hub-quota-monitor&type=date&legend=top-left)](https://www.star-history.com/?repos=Hashmapw%2Fclaude-code-hub-quota-monitor&type=date&legend=bottom-right)
