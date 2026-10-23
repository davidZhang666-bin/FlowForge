# 部署与运维

## Docker Compose

需要 Docker Engine / Desktop 和较新的 Compose v2。先在本机安装依赖以运行环境生成脚本；该脚本使用排他创建，不覆盖已有密码。

```sh
pnpm install --frozen-lockfile
pnpm exec tsx scripts/docker-env.ts
docker compose --env-file .env.docker up --build -d --wait
```

本地入口为 `http://localhost:8080`，默认只绑定环回地址。数据库和 API 不向宿主机暴露端口。Compose 等待 PostgreSQL 就绪、迁移完成后启动 API 和 Worker；Web 等待 API 健康。生产 Cookie 为 Secure，公开部署必须使用 HTTPS，并将 `.env.docker` 中的 `WEB_ORIGIN` 设为外部实际 Origin（协议、主机和端口完全一致）。TLS 可在外层网关终止，保留 SSE 长连接并关闭缓冲。

Dockerfile 分为构建、管理工具、API/Worker 运行和静态 Web 四个目标。运行服务使用非 root 用户，当前保留构建时的完整依赖图以保证 Prisma 生成客户端一致，镜像尚未做生产依赖裁剪。管理工具镜像只在迁移和初始化时运行，运行服务不注入 `DATABASE_ADMIN_URL`。不要把管理环境文件加入 Git 或镜像。

## 首个企业与真实账号

容器不会自动创建演示账号。创建被 Git 忽略的 `.env.bootstrap`：

```dotenv
BOOTSTRAP_TENANT_NAME=示例企业
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=替换为至少十二位随机密码
```

在仓库根目录执行（路径包含空格时保留引号）：

```sh
docker compose --env-file .env.docker run --rm -v "${PWD}/.env.bootstrap:/app/.env.bootstrap:ro" migrate node --env-file=.env.bootstrap --import tsx scripts/bootstrap.ts
```

记下输出的企业 UUID。该命令在一个事务中创建企业、默认部门、管理员、禁用登录的系统调度身份和四份已发布模板；已有邮箱会被拒绝，不会覆盖密码。角色模板在没有合格人员时会阻塞，管理员需要先创建成员并配置处理人。

创建 `.env.member`，再用同样方式挂载执行成员 CLI：

```dotenv
MEMBER_TENANT_ID=上一步的企业UUID
MEMBER_NAME=审批负责人
MEMBER_EMAIL=manager@example.com
MEMBER_PASSWORD=替换为至少十二位随机密码
MEMBER_ROLE=manager
MEMBER_SCOPE=DEPARTMENT
```

```sh
docker compose --env-file .env.docker run --rm -v "${PWD}/.env.member:/app/.env.member:ro" migrate node --env-file=.env.member --import tsx scripts/member.ts
```

只有一个部门时自动选用；多个部门必须提供 `MEMBER_DEPARTMENT_ID`。角色可选 admin、manager、approver、agent、employee，范围可选 SELF、DEPARTMENT、DEPARTMENT_TREE、TENANT。CLI 仅创建新身份，不把已有邮箱隐式加入其他企业，不修改密码。组织界面维护已有成员的角色、部门、有效状态与数据范围；部门新增、身份恢复和企业目录同步目前需要受控管理操作，不提供公开注册。

## 使用现有 PostgreSQL

提供同一数据库的 `DATABASE_ADMIN_URL` 与 `DATABASE_URL`，运行 `pnpm db:provision`。运行角色必须独立、不是表所有者，密码至少 24 字符，不得是 SUPERUSER 或 BYPASSRLS；管理连接需能迁移和授权角色。数据库需事先存在。

随后用环境变量运行 `pnpm db:bootstrap` / `pnpm db:member`。`pnpm build` 后，分别运行 `pnpm start:api` 和 `pnpm start:worker`；静态文件在 `dist/web`。设置 `NODE_ENV=production`、`HOST`、`PORT`、`WORKER_PORT`、`WEB_ORIGIN`。只向运行进程提供 `DATABASE_URL`，管理凭据另行保管。迁移完成后重新执行授权步骤，避免新表缺少运行权限。

## 监控与备份

- API：`GET /health` 检查数据库；Worker：独立进程的 `GET /health` 检查最近扫描。Worker 失败不应被 API 健康掩盖。
- API 输出 JSON 请求日志：请求 ID、路径、方法、状态、耗时；不输出请求体、Cookie 或查询参数。
- 管理界面的事件投递页列出死信与管理审计。先修复投递原因，再点击重新投递；业务审批结果已在原事务提交。
- 备份 PostgreSQL 整个数据库，包含版本、聚合、事件、索引和身份；使用 pg_dump 或托管数据库备份，定期在隔离环境恢复演练。恢复时同时核对运行角色与 RLS 授权。
- `docker compose down` 保留数据卷。`down -v` 会删除数据库卷，只用于明确要销毁的演示/CI环境。
- 会话、登录限流、幂等和历史事件当前不自动归档。根据保留政策增加受控清理作业；不要先删除幂等记录再声称无限重放保障。

## 常见问题

| 现象                   | 排查                                                                            |
| ---------------------- | ------------------------------------------------------------------------------- |
| 本地数据库连接失败     | 在单独终端运行 `pnpm db:start`；查看 `.local/postgres.log`；检查 55432 是否占用 |
| Prisma 客户端缺失      | 运行 `pnpm db:generate`；安装使用仓库指定 pnpm 版本                             |
| CSRF / Origin 被拒绝   | 使用配置的入口地址；确保反向代理保留 Origin；清除旧会话后重新登录               |
| 申请显示异常待指派     | 检查本企业有效成员、角色、静态人员及禁止自审约束；由管理者补充指派              |
| SSE 一直重连           | 检查实例可见权限、Cookie、反向代理缓冲及长连接超时                              |
| 通知停止更新           | 单独检查 Worker 健康、进程日志、Outbox 死信；API 成功不代表 Worker 正常         |
| 第二次 seed 没重置数据 | 这是幂等初始化；需要新演示环境时使用新数据库，不手工删除审计与已发布版本        |

本地 Windows 的应用、数据库和初始化命令已实测。首版代码的 Docker 构建启动、Linux 全套测试及 Windows 冷启动检查均已通过 [远程 CI](https://github.com/davidZhang666-bin/FlowForge/actions/runs/39894492719)。现有数据库需使用 UTF-8；本地初始化和隔离测试显式指定编码，避免英文 Windows 默认 WIN1252 无法存储中文。
