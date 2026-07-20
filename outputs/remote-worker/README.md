# MWI 公会试炼 Vercel 同步服务

该服务连接会员端、会长端和一个 GitHub 私有仓库。会员上传的数据会先裁剪，再以普通 JSON 写入仓库；GitHub PAT 只保存在 Vercel 环境变量中。

## 1. 创建 GitHub 存储

1. 创建一个私有仓库，例如 `mwi-guild-trial-data`。
2. 创建 fine-grained PAT，只授权该私有仓库。
3. Repository permissions 设置为 `Contents: Read and write`。
4. 为 PAT 设置有效期，并在到期前更换 Vercel 环境变量。

## 2. 配置项目

进入服务目录并运行测试：

```powershell
npm test
npm run check
```

首次部署：

```powershell
npx vercel login
npx vercel
```

在 Vercel 项目的 Environment Variables 中添加：

- `GITHUB_TOKEN`：只授权目标私有仓库 `Contents: Read and write` 的 fine-grained PAT。
- `GITHUB_OWNER`：仓库所有者，例如 `overjjjj`。
- `GITHUB_REPO`：仓库名，例如 `-mwi-guild-trial-data`。
- `GITHUB_BRANCH`：`main`。
- `LEADER_TOKEN`：会长端使用的长随机字符串。
- `ALLOWED_ORIGINS`：四个 Milky Way Idle 游戏域名，以英文逗号分隔。

会长令牌建议使用至少 32 字节随机值。

## 3. 正式部署

```powershell
npm test
npm run check
npx vercel --prod
```

部署完成后会得到 `https://...vercel.app` 地址，将其填入会员端和会长端。

## 4. 使用顺序

1. 会长端填写 Vercel 服务地址、公会 ID、`LEADER_TOKEN`。
2. 会长读取成员名单后，在游戏试炼页点击“同步试炼和会员名单”。
3. 会员端填写 Worker 地址和相同公会 ID，点击“读取本角色”，再点击“上传并刷新”。
4. 会长点击“拉取会员上传”，检查成员 CSV，生成分配方案。
5. 会长点击“发布当前方案”。
6. 会员点击“仅刷新分配”，查看个人适配排名和正式分配。

## 数据边界

- 不上传食物、饮料、成就、背包物品或游戏登录凭据。
- 只上传战斗技能等级、10项生活技能、当前战斗装备、能力触发和房屋等级摘要。
- 会员身份按本周公会名单和角色名匹配。该模式没有会员令牌，无法防止懂接口的人伪造同名请求。
- GitHub 仓库中保存普通 JSON，因此仓库必须保持私有；拥有仓库读取权限的协作者可以直接看到会员资料。
