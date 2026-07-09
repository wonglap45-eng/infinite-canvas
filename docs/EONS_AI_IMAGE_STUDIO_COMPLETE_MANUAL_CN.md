# EONS AI Image Studio 内部使用与管理说明书

版本：1.0  
适用范围：公司内部团队  
部署环境：Railway  
Railway 项目显示名：EONS生图无限画布  
Railway 服务名：eons-ai-image-studio  
GitHub 仓库：wonglap45-eng/infinite-canvas  
系统类型：AI 图片工作台

## 文档定位

本文档面向两类读者：

- 员工：了解如何登录、创建画布、生成图片、使用参考图、管理素材和下载成品。
- 管理员：了解如何配置 Railway 环境变量、维护 API Key、设置登录密码、排查失败和理解数据边界。

## 系统概览

EONS AI Image Studio 是公司内部使用的 AI 图片工作台，支持无限画布、文生图、图生图、参考图编辑、局部编辑、提示词生成、提示词库、素材管理、图片下载、错误日志和成本估算。

系统只供公司内部团队使用，不面向外部访客开放。员工不需要配置模型 API Key，所有模型 Key 由管理员在 Railway 环境变量中维护。

Railway 后台当前项目显示名为 `EONS生图无限画布`，服务名为 `eons-ai-image-studio`，生产环境为 `production`。员工日常界面仍显示 `EONS AI Image Studio`。

## 快速开始

1. 打开公司提供的 Railway 域名。
2. 进入登录页，输入管理员分配的用户名和密码。
3. 进入主界面后选择“我的画布”或“生图工作台”。
4. 上传产品参考图，或直接输入提示词。
5. 选择模型、比例、质量和生成数量。
6. 点击生成，并在生成前确认窗口中检查成本和风险提示。
7. 保存满意结果到“我的素材”或下载到本地。

## 登录与权限

当前版本使用统一内部账号密码登录，不使用第三方登录。登录成功后系统写入 httpOnly cookie，有效期为 7 天。

管理员在 Railway 中设置：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-password
```

修改 `ADMIN_PASSWORD` 后，旧登录状态会失效，所有员工需要重新登录。

## 数据隔离与多人使用

系统支持多人同时在线使用。Railway 提供统一 Web 服务，多个员工可以同时打开页面并发起生成请求。

当前版本的大部分项目数据保存在员工自己的浏览器本地，包括：

- 画布项目
- 我的素材
- 图片缓存
- 生成记录
- 错误日志
- 部分界面设置

因此，不同电脑、不同浏览器、不同浏览器用户通常看不到彼此的数据。同一台电脑、同一个浏览器用户则会看到同一份本地数据。

当前版本不是完整的多员工云端账号系统。换电脑后不会自动同步项目；清理浏览器站点数据可能导致本地项目和素材丢失。

## 员工日常工作流

### 亚马逊商品图

推荐使用“亚马逊工作流”入口，适合白底主图、产品场景图、卖点强化图、A+ 详情质感图、换背景不换产品、包装高级化、局部重绘和多角度变体组图。

建议流程：

1. 上传清晰产品参考图。
2. 选择“亚马逊工作流”模板。
3. 补充本次具体需求。
4. 确认模型和生成数量。
5. 生成前检查参考图数量、点数和提示词风险。
6. 生成后保留最佳结果。

提示词应明确说明：保留品牌识别、包装比例、瓶型或盒型、标签位置、主色、配件类型和核心视觉层级。避免额外文字、水印、扭曲 logo、虚构包装和不可读标签。

### 文生图

文生图适合没有参考图的概念图。提示词建议包含主体、场景、构图、光线、背景、风格和禁止项。

### 图生图

图生图适合基于产品参考图生成新图片。请确认参考图已经上传或连接到生图节点。商品图生成时，参考图通常比单纯文字更稳定。

### 局部编辑

局部编辑适合只修改图片中的小区域。使用画笔涂抹要修改的区域，再输入具体要求，例如：

```text
只修改蒙版区域，其他区域保持不变。把瓶盖改成白色，保持原有光影、材质和瓶身标签不变。
```

蒙版越准确，结果越稳定。不要涂抹过大区域，否则模型可能重绘过多内容。

### 提示词生成

如果员工只知道简单需求，可以先使用“生成提示词”入口。系统会生成中文提示词，方便人工检查。生成后仍建议确认是否包含产品保真、构图、背景、光线、质量和负面约束。

### 提示词库与素材库

提示词库用于查找灵感和复制模板。我的素材用于保存常用产品图、成品图、提示词和参考素材。当前素材主要保存在浏览器本地，重要成品请另外下载或备份到公司文件夹。

## 多图生成策略

当一次生成多张图片时，系统会分别请求模型，并追加中性差异要求：原始提示词最高优先级，不改变图片类型、用途、背景方向、主体关系和禁止项；只要求结果在构图、镜头距离、角度、光影、产品位置或细节上有所区别。

系统不会再用固定关键词判断主图或副图，也不会替用户改变原始提示词意图。

## 点数与成本估算

系统显示的点数是内部估算值，用来提醒成本和避免误消耗，不代表第三方平台真实账单。

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

质量和尺寸：

```text
high：x 1.7
medium：x 1.25
auto/low：x 1
2K 附近尺寸：x 1.35
4K：x 2.4
普通尺寸：x 1
```

真实费用以 OpenRouter 或第三方平台账单为准。

## Railway 环境变量

推荐配置：

```env
NODE_ENV=production

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-password

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

如果一个 API Key 无法访问多个模型，应分别设置图片模型 Key 和文本模型 Key。

## 部署与维护

系统使用根目录 Dockerfile 部署到 Railway。Railway 会注入 `PORT`，服务监听 `0.0.0.0`。

当前生产环境记录：

- Railway 项目显示名：`EONS生图无限画布`
- Railway 服务名：`eons-ai-image-studio`
- GitHub 仓库：`wonglap45-eng/infinite-canvas`
- 线上地址：`https://eons-ai-image-studio-production.up.railway.app`

本地测试：

```bash
docker build -t eons-ai-image-studio .
docker run --rm -p 3000:3000 eons-ai-image-studio
```

如果部署失败，优先检查 Dockerfile、PORT、启动命令、Railway 构建日志和环境变量。

## 常见问题

### 登录失败

检查 Railway 是否设置 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`，保存变量后是否重新部署。修改密码后需要重新登录。

### 图片无法生成

检查 `OPENAI_IMAGE_API_KEY`、`OPENAI_IMAGE_BASE_URL`、`OPENAI_IMAGE_MODELS` 和 `OPENAI_IMAGE_GENERATIONS_PATH`。同时查看 Railway 日志和第三方平台返回的错误信息。

### 提示词生成失败

检查 `OPENAI_TEXT_API_KEY`、`OPENAI_TEXT_BASE_URL` 和 `OPENAI_TEXT_MODELS`，确认文本模型 Key 有权限访问当前模型。

### 生成结果重复

确认是否一次生成太多，提示词是否要求“每张图不同”。当前系统会追加中性差异要求，但最终差异仍取决于模型能力和参考图限制。

### 换电脑看不到项目

当前项目主要保存在浏览器本地，不支持个人云端同步。需要后续建设多用户账号、数据库和对象存储。

## 合规说明

本项目基于开源项目改造，必须保留开源协议和必要声明。

保留位置：

- `LICENSE`
- `ATTRIBUTION.md`
- Web 应用 `/license`

员工日常界面不展示原项目来源、GitHub 链接、Powered by、Made by 等信息，但不得删除开源协议和版权声明。

## 管理员检查清单

- Railway 服务状态为 Online。
- `/login` 可以访问。
- 未登录不能进入主界面。
- 登录后可以进入画布和生图工作台。
- 前端不显示 API Key。
- 图片模型和文本模型可以正常调用。
- 错误日志与成本控制可以打开。
- `/license` 可以访问。
- API Key 未提交到 Git。
- `ADMIN_PASSWORD` 使用强密码。
