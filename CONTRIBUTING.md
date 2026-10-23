# 贡献指南

使用 Node.js 24 LTS 和 `package.json` 锁定的 pnpm 版本。先按 README 启动本地数据库，测试必须使用隔离脚本，不直接针对演示库执行破坏性 SQL。

## 变更约定

- 分支采用 `codex/` 或简短功能前缀；每次提交对应可描述、可验证的行为变更，避免空提交和拆分无意义修改。
- 核心领域只依赖 contracts，不引入 NestJS、Prisma、HTTP 或真实时钟。规则必须使用受限 DSL，不加入动态脚本执行。
- 新状态转换应明确操作者、前置状态、事件、终态与重复操作语义，补充业务测试。
- 所有租户数据访问通过租户事务。新增表必须有对应 RLS、租户复合外键和受限角色授权；不能以管理员数据库连接替代运行角色测试。
- Schema 变更追加迁移，不修改已经发布的迁移。生成 OpenAPI 使用 `pnpm exec tsx scripts/openapi.ts`，不要手工维护第二份接口契约。
- 通知等副作用从 Outbox 消费，不能在审批事务提交前调用外部服务。

## 提交前

```sh
pnpm format:check
pnpm verify
pnpm test:coverage
pnpm test:integration
pnpm test:bootstrap
pnpm test:e2e
pnpm audit
```

PR 描述说明触发问题、变更后的行为、验证证据及兼容性影响。界面变更附截图，权限变更说明企业/部门/参与关系边界。禁止提交 `.env`、数据库目录、访问令牌、真实企业数据或包含敏感内容的 trace。
