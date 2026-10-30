## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm knip && pnpm test && pnpm typecheck && pnpm build`.
  Commits follow Conventional Commits.

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
