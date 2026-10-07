# 全球电台（GlobalRadio）

这是一个基于 Vue 3 + Vite 的在线电台应用，包含播放、搜索、收藏、历史记录、主题切换与多国语言等功能，并支持 PWA 安装。

支持 Docker 一键部署（推荐）与本地开发运行。

## 功能概览

- 电台搜索（支持中文）
- 分享电台
- 播放控制
- 睡眠定时器
- 收藏与播放历史
- 亮色/暗色主题
- 全球主流语言支持
- 安卓/iphone/PC客户端

## 演示站点
### https://aabb.live

### 现已加入https://kejilion.sh 科技lion的脚本，实现一键安装并配置域名和SSL证书功能。

## 应用截图
![](demo-w.png)
![](demo-b.png)
![](demo-phone.png)

## AI 电台（中波 / 电子管收音机音色）

这是站点首页 `/`（开发时 http://localhost:4173/）。原来的全球电台（搜索、收藏、历史、分享）移到了 `/classic/`，首页设置里有入口。

- 八个快捷调频（随心 / 新发现 / 专注 / 在路上 / 深夜 / 老歌 / 运动 / 爵士），仿真调频旋钮，定时暂停推子，电台语言偏好（中文 / English）。
- **音质旋钮**：原声 / 中波 / 电子管。中波、电子管会让整台电台的声音经过一条老收音机模拟链（`src/ai-radio/audio/amRadio.ts`）：
  单声道；约 150 Hz–3.5 kHz 带宽（高端 −3 dB 在 2.5–3 kHz，4 kHz 以上急速衰减）；
  AGC 压缩 + 偏重偶次谐波的软削波；经带宽限制的嘶嘶底噪（约 25–35 dB 信噪比，信号衰落时更差）、静电噼啪、载波起伏与衰落、
  极轻的 50/60 Hz 交流哼声、偶发邻频串台杂音与短促啸叫；小纸盆喇叭 + 箱体共振、中频偏前。
  只使用原生 Web Audio 节点，没有 AudioWorklet，因此在 http 局域网地址上也能工作。
- 调台旋钮：拖动（或鼠标滚轮、键盘方向键）在 87.5–108 MHz 之间连续调台，靠近频道时磁吸锁定并连接电台，电台之间只有电波噪声；点频道按钮时旋钮会自己转过去。
- 音效调节：主页「音效调节」是一排调音台推子，分两组。音色：带宽、低切、失真、压缩、箱声；电波：底噪、静电、哼声、串台、衰落。中间一格是这台收音机原本的样子（双击推子恢复），电波类推到底是关；设置会被记住，原声模式下不生效。
- 主题：设置里可在「深色」和「复古黄」之间切换（奶油黄 + 胶木棕 + 朱红指示灯），选择会被记住。颜色全部由 `src/ai-radio/style.css` 顶部的变量定义，要加新主题只需再写一组变量。
- 音源：真实的网络电台。先试精选的 SomaFM 频道，再从 [Radio Browser](https://www.radio-browser.info) 社区目录按预设风格取电台（语言偏好选中文时，先试国内线路的中文音乐台）。Web Audio 只能处理带 CORS 头的流，所以每个候选先用 CORS 请求探测，只播放通过的 https 流；点面板右上角「换台」切到同频道的下一个电台，成功的电台会被记住。全都收不到时切换到内置乐队；设置里也可载入本地音乐。

## GitHub Pages 部署

仓库自带工作流 `.github/workflows/pages.yml`：推送到 `main`（或在 Actions 页手动运行）即构建并发布到 GitHub Pages。
首次使用：仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
发布地址是 `https://<用户名>.github.io/global-radio/`；构建时通过 `VITE_BASE` 自动带上子路径，绑定自定义域名时则为根路径。
本地模拟：`VITE_BASE=/global-radio/ npm run build`。

## 目录结构

```text
.
├── src/                 # 前端源码
├── public/              # 静态资源
├── dist/                # 构建产物（Vite build 输出）
├── nginx-static.conf    # 静态站点 Nginx 示例配置
├── nginx.docker.conf    # Docker 镜像内 Nginx 配置
├── Dockerfile           # Docker 构建文件
├── vite.config.ts       # Vite 配置
└── package.json         # 前端依赖与脚本
```
## Docker 部署

适用场景：不想安装 Node.js，只想用容器快速部署；或者希望用 Nginx 直接提供静态站点服务。

### 方式 A：Docker Hub 一键部署（推荐）

```bash
docker pull superneed/global-radio:latest
docker run -d --name global-radio --restart unless-stopped -p 8080:80 superneed/global-radio:latest
```
浏览器访问：
- http://localhost:8080/

#### ARM/arm64 设备部署

如果你的服务器是 ARM 架构（例如 aarch64 / arm64），请使用 arm64 专用镜像：

```bash
docker pull superneed/global-radio-arm64:latest
docker run -d --name global-radio --restart unless-stopped -p 8080:80 superneed/global-radio-arm64:latest
```

### 方式 B：本地构建镜像并运行（可选）

安装 Docker（Linux 示例；也可使用官方文档的安装方式）：

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
```

构建镜像：

```bash
docker build -t global-radio:latest .
```

运行容器（映射到本机 8080 端口）：

```bash
docker run --rm -p 8080:80 global-radio:latest
```

浏览器访问：
- http://localhost:8080/

建议用于生产的运行方式：

1) 直接运行（前置 8080）：

```bash
docker run -d --name global-radio --restart unless-stopped -p 8080:80 global-radio:latest
```

2) 需要自定义域名与 HTTPS 时：在宿主机用 Nginx / Caddy 做反向代理到 `127.0.0.1:8080`，容器内只负责静态资源服务。

更新部署（Docker）：

```bash
docker build -t global-radio:latest .
docker rm -f global-radio || true
docker run -d --name global-radio --restart unless-stopped -p 8080:80 global-radio:latest
```

## 获取源码

```bash
git clone https://github.com/moli-xia/global-radio.git
cd global-radio
```

## 环境要求

- Node.js 18+（推荐 18 LTS）
- npm 9+（建议使用 `npm ci`）
- Docker 20+（仅 Docker 部署需要）

## 本地安装与开发

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 4173
```

浏览器访问：
- http://localhost:4173/

局域网访问（同网段设备）：
- http://<你的电脑IP>:4173/

## 构建与预览

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

浏览器访问：
- http://localhost:4173/

## 生产部署（静态站点）

推荐用 Nginx 直接托管 `dist/`：

1) 构建：

```bash
npm run build
```

2) 部署构建产物（示例）：

```bash
rm -rf /var/www/global-radio/dist
mkdir -p /var/www/global-radio
cp -r dist /var/www/global-radio/dist
```

3) 参考 nginx-static.conf 配置站点 root 指向 `dist/`，然后重载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

静态站点要点：
- SPA 路由需要回退到 index.html（nginx-static.conf 已包含示例）
- 建议对静态资源开启缓存（js/css/svg/png 等），对 index.html 关闭缓存，避免更新后仍加载旧版本

## 环境变量

如需环境变量，按 .env.example 创建 `.env`。不需要时可不创建。

## 运维建议

- 生产环境建议使用 Nginx 托管 `dist/`，前端不需要长期运行 Vite 服务。
- 如需临时自测，可用 `npm run preview` 在指定端口提供静态预览。
- 首页“音乐电台/最新电台”列表有内存缓存（默认 5 分钟），刷新按钮会绕过缓存重新拉取数据。

## 常见问题：无法访问

1) 先确认 dist 是否存在且有 index.html：

```bash
npm run build
ls -la dist/
```

2) 如果使用 nginx-static.conf：

- 该配置默认使用 80 端口提供静态站点服务，不依赖 HTTPS 证书
- 修改 server_name 与 root 路径后，重载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

3) 如果用 `npm run preview`：

```bash
npm run preview -- --host 0.0.0.0 --port 4173
```

确保服务器安全组/防火墙放行对应端口。
