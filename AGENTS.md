## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm knip && pnpm test && pnpm typecheck && pnpm build`.
  Commits follow Conventional Commits.
- 防过度防御：几乎不会发生边界/并发问题，讲清概率并经用户确认后再加，严禁为
“理论上更稳”私自膨胀代码。
- 入口单次校验：外部数据只在边界校验一次，内部靠类型系统流转，禁止层层重复判断。
- 拒绝提前抽象：单次使用逻辑就近内联，不随意提前拆分无意义 helper。
- 控制复杂度：非必要不用try/catch，能单函数清晰搞定的别硬拆。

## Project stage

- The package is **unreleased and under active development**: no external users
  depend on the current API surface yet.
- Breaking API changes **MAY** be made freely - renaming or removing exported
  functions, types and options, and changing config file formats. Do not add
  compatibility shims, deprecation aliases or migration paths for unpublished
  APIs.
- When a public API changes, update the API snapshots
  (`pnpm test` with `TSNAPI_ALLOW_BREAKING=1` and `-u`) in the same change, and
  update the README to match.
