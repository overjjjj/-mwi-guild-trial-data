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
- `LEADER_TOKEN`：只保存在服务端的签名主密钥，用于签发绑定公会编号的独立管理密钥。
- `ALLOWED_ORIGINS`：四个 Milky Way Idle 游戏域名，以英文逗号分隔。

签名主密钥建议使用至少 32 字节随机值，不要写入或发送给普通会长端。

## 3. 正式部署

```powershell
npm test
npm run check
npx vercel --prod
```

公共脚本已内置正式服务地址；自行部署时可在两端的高级连接设置中替换。

## 4. 使用顺序

1. 新会长在会长端点击“创建在线公会”，获得随机公会编号和独立管理密钥；旧版会长点击“升级旧公会”。
2. 会长把公会编号发给会员，然后读取成员名单并同步本周试炼和会员名单。
3. 会员端填写相同公会编号，点击“一键上传并查看分配”。
4. 会长点击“拉取会员上传”，检查成员 CSV，生成分配方案。
5. 会长点击“发布当前方案”。
6. 会员点击“仅刷新分配”，查看个人适配排名和正式分配。

## 数据边界

- 不上传食物、饮料、成就、背包物品或游戏登录凭据。
- 只上传战斗技能等级、10项生活技能、当前战斗装备、能力触发和房屋等级摘要。
- 会员身份按本周公会名单和角色名匹配。该模式没有会员令牌，无法防止懂接口的人伪造同名请求。
- GitHub 仓库中保存普通 JSON，因此仓库必须保持私有；拥有仓库读取权限的协作者可以直接看到会员资料。
- `POST /v1/guilds` 只签发随机公会编号和绑定凭据，本身不写 GitHub；实际同步时才创建公会周数据。
- 独立管理密钥不能跨公会使用。旧全局令牌只用于兼容和迁移，不应分发。
