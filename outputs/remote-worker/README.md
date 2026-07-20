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
- `MEMBER_TOKEN_SECRET`：用于签发会员邀请令牌的另一条长随机字符串。
- `ALLOWED_ORIGINS`：四个 Milky Way Idle 游戏域名，以英文逗号分隔。

两条令牌建议分别使用至少 32 字节随机值，不要相同。

## 3. 正式部署

```powershell
npm test
npm run check
npx vercel --prod
```

部署完成后会得到 `https://...vercel.app` 地址，将其填入会员端和会长端。

## 4. 使用顺序

1. 会长端填写 Vercel 服务地址、公会 ID、`LEADER_TOKEN`。
2. 会长导入成员名单后点击“生成会员邀请”，把每一行令牌分别发给对应会员。
3. 会长在游戏试炼页点击“同步本周试炼”，会员随后即可刷新个人适配排名。
4. 会员端填写 Worker 地址和自己的邀请令牌，点击“读取本角色”，再点击“上传并刷新”。
5. 会长点击“拉取会员上传”，检查成员 CSV，生成分配方案。
6. 会长点击“发布当前方案”。
7. 会员点击“仅刷新分配”，查看个人适配排名和正式分配。

## 数据边界

- 不上传食物、饮料、成就、背包物品或游戏登录凭据。
- 只上传战斗技能等级、10项生活技能、当前战斗装备、能力触发和房屋等级摘要。
- 会员身份由签名令牌绑定，上传正文中的姓名不会改变实际归属。
- GitHub 仓库中保存普通 JSON，因此仓库必须保持私有；拥有仓库读取权限的协作者可以直接看到会员资料。
