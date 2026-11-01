# Contributing

感谢你对本项目的关注。提交 PR 前请注意：

- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)。
- 本地必须通过全部门禁：`pnpm lint && pnpm knip && pnpm test && pnpm typecheck && pnpm build`。
- 代码风格由 [@antfu/eslint-config](https://github.com/antfu/eslint-config) 统一管理，无需手动格式化。
- pre-commit 只对暂存文件跑 eslint（秒级）；完整门禁 `pnpm run ci` 在 pre-push
  执行，CI 上同样执行。跳过本地 hooks：`git commit/push` 时设置
  `SKIP_SIMPLE_GIT_HOOKS=1`（CI 不受影响，仍会跑全量门禁）。
