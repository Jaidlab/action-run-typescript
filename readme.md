# action-run-typescript

Run inline TypeScript in GitHub Actions using Bun in a Docker container.

This is a Docker container action, so it is meant for Linux runners with Docker support, such as `ubuntu-latest` or compatible self-hosted runners.

## Usage

```yml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [24]
    steps:
      - name: run TypeScript
        uses: Jaidlab/action-run-typescript@v0.1.0
        with:
          globals: |-
            {
              matrix: ${{ toJson(matrix) }},
              answer: 42,
            }
          code: |-
            console.log('hi')
            console.dir({
              answer,
              coreInfo: typeof core.info,
              github,
              matrix,
              runner,
            })
```

## Available bindings

By default, `goodies` contains every built-in name, so your inline code runs in a dedicated Bun child process from the workflow workspace root with these bindings available without importing anything:

- `core` – the imported `@actions/core` module
- `github` – a best-effort GitHub context built from `@actions/github.context`, plus compatibility aliases like `github.repository`, `github.run_id`, `github.event` and `github.repo`
- `job` – a best-effort job context. It always includes `job.id` from `GITHUB_JOB` and may also include `name`, `status`, `conclusion`, `workflow_job_id`, `workflowJobId` and `url`
- `runner` – a best-effort runner context built from runner environment variables and `@actions/core.platform`
- `matrix` – `{}` by default
- `strategy` – `{}` by default
- `steps` – `{}` by default or a best-effort fallback derived from the workflow jobs API
- `workflowJob` – best-effort metadata for the current workflow job, including its step list when available
- every top-level field from `with.globals` – these are assigned after the built-in bindings, so they can override names like `core`, `matrix`, `strategy` or `steps`
- standard Bun, Node and web globals such as `Bun`, `fetch`, `console`, `process`, `Buffer`, `URL` and friends

Bindings are assigned onto `globalThis` before your code is imported, so local modules can use either bare identifiers like `matrix` or explicit access like `globalThis.matrix`. Use `goodies: []` to skip the built-in goodies injection entirely, or pass a subset like `goodies: core, matrix` to inject only specific goodies. Explicit `with.globals` values are still assigned in every mode.

## Passing extra globals

`globals` is evaluated as a JavaScript expression and must produce an object. Plain JSON and JSON5-style object literals still work, but richer values like functions, regular expressions, `Date` instances and `undefined` are also supported.

This is also the preferred way to inject workflow expression contexts that the Actions toolkit does not expose directly, such as `matrix`, `strategy` and the real `steps` context with step outputs:

```yml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [24]
    steps:
      - id: prepare
        run: echo "value=42" >> "$GITHUB_OUTPUT"
      - uses: Jaidlab/action-run-typescript@v0.1.0
        with:
          globals: |-
            {
              matrix: ${{ toJson(matrix) }},
              strategy: ${{ toJson(strategy) }},
              steps: ${{ toJson(steps) }},
              release: {
                channel: 'nightly',
              },
            }
          code: |-
            console.dir({
              node: matrix.node,
              output: steps.prepare.outputs.value,
              release,
            })
```

If you do not pass `steps`, the action still tries to populate `steps` and `workflowJob` from the GitHub Actions jobs API. That fallback is useful for introspection, but it cannot reconstruct step outputs. In that mode, `steps` is shaped like `{ $source, $job, $list, $byName, $byNumber, $bySlug }`.

## Imports and execution

The inline script is executed directly by Bun from the workspace root. This means:

- relative imports behave as expected from the workspace root
- local `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` and `.json` files are executed natively by Bun
- inline TSX and local TSX or JSX imports are supported
- bare package imports resolve from the workspace first, then from temporary `dependencies`, then from the action image’s preinstalled dependencies through `NODE_PATH`
- if `NODE_ENV` is unset, the child process defaults it to `production` before your script is imported so JSX uses `react/jsx-runtime` by default

Example:

```yml
- uses: Jaidlab/action-run-typescript@v0.1.0
  with:
    code: |-
      import packageJson from './package.json'
      import component from './src/component.tsx'
      console.dir({packageJson, component})
```

If your code uses JSX, the corresponding runtime helpers, such as `react/jsx-runtime` or `react/jsx-dev-runtime`, must be resolvable from the workspace, from temporary `dependencies` or from the action image.

## `dependencies`

If you pass `dependencies`, the action creates a fresh temporary folder, runs `bun add <your input>` there and prepends that folder’s `node_modules` to `NODE_PATH` for the inline execution.

This is useful when the workflow workspace does not already contain the packages you need, or when you want a couple of throwaway helpers that should not be committed into the repository. The value is split into shell-style arguments, so forms like these work:

```yml
- uses: Jaidlab/action-run-typescript@v0.1.0
  with:
    dependencies: react react-dom
    code: |-
      import {jsx} from 'react/jsx-runtime'
      console.log(typeof jsx)
```

## Preinstalled packages

The action image ships a small set of dependencies that are immediately importable from your inline code:

- `@actions/core`
- `@actions/github`
- `es-toolkit`
- `fs-extra`
- `globby`

That means code like this works without adding those packages to the workflow workspace itself:

```ts
import * as core from '@actions/core'
import {globby} from 'globby'
```

## Using `@actions/core`

`core` is injected as a global by default because the default `goodies` set includes `core`. You can still import `@actions/core` explicitly from your script if you prefer that style, or if you omit `core` from `goodies`:

```ts
import * as core from '@actions/core'
```

## `goodies`

`goodies` selects which built-in goodies are injected. Supported names are `core`, `github`, `job`, `matrix`, `runner`, `steps`, `strategy` and `workflowJob`.

By default, `goodies` contains all of them.

Accepted forms include:

- `goodies: core`
- `goodies: core, github, matrix`
- `goodies: ['core', 'github', 'matrix']`
- `goodies: []`

Duplicates are ignored. Unknown values fail the action.

If you set `goodies: []`, no built-in goodies are injected, but the action still evaluates `globals` and assigns every top-level field from that object onto `globalThis`.

## `github-token`

The optional `github-token` input is only used for best-effort workflow job and step lookup through the GitHub API. It defaults to `${{ github.token }}`, which is usually enough for the current repository.

If you override it with an empty value or a token without repository access, the inline script still runs, but `workflowJob` and the fallback `steps` metadata may be incomplete or unavailable.

## Notes

- GitHub context is gathered from the Actions toolkit instead of being passed through action inputs.
- `matrix`, `strategy` and the real `steps` context are not available directly through the Actions toolkit. Use `globals` when you need them.
- The action is a Docker container action, so it requires a Linux runner with Docker support.
- `GITHUB_TOKEN` is exposed to the script environment when available.
- The script runs from the workflow workspace root, not from the action repository.
- Bun is included in the action image, so no Bun installation is required in your workflow.
