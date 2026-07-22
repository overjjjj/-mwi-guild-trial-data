# Milky Way Idle 公会试炼分配

## 文件

- `milkyway-guild-trial-member.user.js`：会员端油猴脚本。
- `milkyway-guild-trial-allocator.user.js`：会长端油猴脚本和全局分配器。
- `remote-worker/`：Vercel 同步服务，使用 fine-grained PAT 写入 GitHub 私有仓库。
- `milkyway-guild-trial-allocator-plan.md`：算法、字段和限制说明。

## 部署顺序

1. 按 `remote-worker/README.md` 部署 Vercel 服务。
2. 会长安装 `milkyway-guild-trial-allocator.user.js`，点击“创建在线公会”并保存管理备份。
3. 会长把自动生成的公会编号发给会员，读取成员后同步试炼和会员名单。
4. 会员安装 `milkyway-guild-trial-member.user.js`，填写相同的公会编号。
5. 会员按当前角色名上传后，会长拉取数据、生成方案并发布。

油猴脚本不会直接持有 GitHub 凭据。未部署同步服务时，会长端原有的本地 CSV 和手工导入功能仍可独立使用。
