# EONS AI Image Studio 管理员说明书

适用对象：项目管理员、部署维护人员、内部 IT 或技术负责人。

本文档说明 EONS AI Image Studio 的部署、环境变量、登录保护、API Key 配置、数据存储和常见维护事项。

## 1. 系统定位

EONS AI Image Studio 是公司内部 AI 图片工作台，用于：

- 无限画布图片创作
- 文生图
- 图生图
- 参考图编辑
- 局部编辑
- 提示词生成
- 提示词库
- 素材管理
- 图片下载
- 错误日志与成本估算

系统不面向公网普通访客开放，应仅供公司内部团队使用。

## 2. 部署方式

当前项目部署在 Railway，使用根目录 Dockerfile 构建。

本地 Docker 测试命令：

```bash
docker build -t eons-ai-image-studio .
docker run --rm -p 3000:3000 eons-ai-image-studio
```

Railway 部署流程：

1. 将代码推送到公司或个人的私有 GitHub 仓库。
2. Railway 新建项目。
3. 选择 Deploy from GitHub Repo。
4. 选择私有仓库。
5. Railway 使用 Dockerfile 构建。
6. 部署成功后访问 Railway 域名。

服务监听：

```text
0.0.0.0
process.env.PORT || 3000
```

## 3. 登录保护

系统使用简单的内部账号密码登录，不使用第三方登录。

环境变量：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
```

登录成功后：

- 写入 `httpOnly` cookie。
- cookie 名称：`eons_session`。
- 有效期：7 天。
- 生产环境 cookie 使用 `secure`。

注意：

- 修改 `ADMIN_PASSWORD` 会让旧 cookie 失效，所有员工需要重新登录。
- 当前版本是统一内部账号，不是多员工独立账号系统。

## 4. 设置或修改登录密码

在 Railway 中操作：

1. 进入 Railway 项目。
2. 选择服务 `eons-ai-image-studio`。
3. 进入 Variables。
4. 设置：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码
```

5. 保存后等待 Railway 自动重新部署。
6. 打开 `/login` 使用新账号密码登录。

建议：

- 不要使用 `change-me`。
- 不要把密码提交到 Git。
- 如果员工离职或密码泄露，立即修改 `ADMIN_PASSWORD`。

## 5. AI API Key 配置

员工前端不需要配置 API Key，API Key 只放在 Railway 环境变量中。

推荐变量：

```env
NODE_ENV=production

ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password

OPENAI_API_KEY=
OPENAI_BASE_URL=

OPENAI_IMAGE_API_KEY=
OPENAI_IMAGE_BASE_URL=https://openrouter.ai/api/v1
OPENAI_IMAGE_MODELS=openai/gpt-image-2
OPENAI_IMAGE_GENERATIONS_PATH=/images

OPENAI_TEXT_API_KEY=
OPENAI_TEXT_BASE_URL=https://openrouter.ai/api/v1
OPENAI_TEXT_MODELS=openai/gpt-5.5
```

说明：

- `OPENAI_API_KEY` 是兜底 key。
- 如果第三方平台一个 key 不能访问所有模型，应使用分离 key：
  - `OPENAI_IMAGE_API_KEY` 用于图片模型。
  - `OPENAI_TEXT_API_KEY` 用于文本/提示词模型。
- `OPENAI_IMAGE_MODELS` 和 `OPENAI_TEXT_MODELS` 用于模型路由。
- OpenRouter 图片接口使用 `/images`，所以需要 `OPENAI_IMAGE_GENERATIONS_PATH=/images`。

不要把真实 API Key 写入：

- 代码文件
- README
- `.env.example`
- 前端 localStorage
- 浏览器设置界面

## 6. 数据存储说明

当前版本主要使用浏览器本地存储：

- localStorage
- IndexedDB
- localforage

保存内容包括：

- 画布项目
- 我的素材
- 图片缓存
- 生成记录
- 错误日志
- 部分界面设置

实际隔离效果：

- 不同员工使用不同电脑，通常看不到彼此数据。
- 不同浏览器或不同浏览器用户，通常也是独立数据。
- 同一电脑、同一浏览器用户，会共享同一份本地数据。

限制：

- 换电脑不会自动同步项目。
- 清理浏览器站点数据可能丢失项目和素材。
- 当前不是严格的账号级服务端数据隔离。

如果需要真正的员工独立账号，需要后续增加：

- 多用户账号系统
- 服务端数据库
- 图片对象存储，例如 R2/S3
- 按 userId 隔离项目和素材

## 7. 成本点数说明

系统显示的点数是内部估算值，用于提醒和控制误消耗，不代表第三方平台真实费用。

公式：

```text
估算点数 =
（操作基础值 + 参考图数量 x 0.2 + 长提示词加成）
x 质量系数
x 尺寸系数
x 生成张数
```

基础值：

```text
提示词生成：0.25
文生图：1
图生图：1.35
局部编辑：1.55
每张参考图：+0.2
提示词超过 1000 字：+0.15
```

质量系数：

```text
high：x 1.7
medium：x 1.25
auto/low：x 1
```

尺寸系数：

```text
2K 附近尺寸：x 1.35
4K：x 2.4
普通尺寸：x 1
```

真实费用请以 OpenRouter 或第三方平台账单为准。

## 8. 常见故障排查

### 无法登录

检查：

- Railway 是否设置 `ADMIN_USERNAME`。
- Railway 是否设置 `ADMIN_PASSWORD`。
- 修改变量后是否重新部署。
- 浏览器是否访问的是最新 Railway 域名。

### 图片无法生成

检查：

- `OPENAI_IMAGE_API_KEY` 是否正确。
- `OPENAI_IMAGE_BASE_URL` 是否正确。
- `OPENAI_IMAGE_MODELS` 是否包含当前选择模型。
- `OPENAI_IMAGE_GENERATIONS_PATH` 是否与第三方平台一致。
- Railway 日志中 `/api/ai/openai/images/generations` 或 `/images` 是否报错。

### 提示词生成失败

检查：

- `OPENAI_TEXT_API_KEY` 是否正确。
- `OPENAI_TEXT_BASE_URL` 是否正确。
- `OPENAI_TEXT_MODELS` 是否包含当前文本模型。
- 第三方 key 是否有该模型权限。

### 生成结果重复

建议：

- 减少单次生成数量。
- 使用“多角度变体组图”模板。
- 在提示词中明确要求不同构图、不同角度、不同光影。
- 确认不是重复连接同一张结果图。

### 局部编辑不支持

原因：

- 当前图片模型可能不支持蒙版局部编辑。
- 模型或第三方接口没有开放 image edit/mask 能力。

处理：

- 换支持编辑的图片模型。
- 使用普通图生图描述局部修改要求。

## 9. 合规说明

本项目基于开源项目改造，应保留开源合规信息。

必须保留：

- `LICENSE`
- `ATTRIBUTION.md`
- Web 应用中的 `/license`

员工日常工作界面不展示原项目来源、GitHub 链接、Powered by、Made by 等信息，但不得删除开源协议和必要版权声明。

## 10. 管理员维护建议

建议定期检查：

- Railway 部署日志
- 第三方平台 API 账单
- API Key 权限和有效期
- 员工是否仍使用统一密码
- 是否需要升级为多用户账号系统
- 是否需要服务端素材/项目存储

上线前建议确认：

- `/login` 可访问。
- 未登录无法进入主界面。
- 登录后可进入主界面。
- 前端看不到 API Key。
- 生图和提示词生成正常。
- `/license` 可访问。

