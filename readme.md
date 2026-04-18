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
              github,
              matrix,
              runner,
            })
```

## Available bindings

Your inline code runs in a dedicated Bun child process from the workflow workspace root. These bindings are available without importing anything:

- `github` – a best-effort GitHub context built from `@actions/github.context`, plus compatibility aliases like `github.repository`, `github.run_id`, `github.event` and `github.repo`
- `job` – a best-effort job context. It always includes `job.id` from `GITHUB_JOB` and may also include `name`, `status`, `conclusion`, `workflow_job_id`, `workflowJobId` and `url`
- `runner` – a best-effort runner context built from runner environment variables and `@actions/core.platform`
- `matrix` – `{}` by default
- `strategy` – `{}` by default
- `steps` – `{}` by default or a best-effort fallback derived from the workflow jobs API
- `workflowJob` – best-effort metadata for the current workflow job, including its step list when available
- every top-level field from `with.globals` – these are assigned after the built-in bindings, so they can override names like `matrix`, `strategy` or `steps`
- standard Bun, Node and web globals such as `Bun`, `fetch`, `console`, `process`, `Buffer`, `URL` and friends

Bindings are assigned onto `globalThis` before your code is imported, so local modules can use either bare identifiers like `matrix` or explicit access like `globalThis.matrix`.

## Passing extra globals

`globals` is parsed with `json5`, so comments, trailing commas and unquoted keys are allowed. The input must evaluate to an object.

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
- bare package imports resolve from the workspace first and then from the action image’s preinstalled dependencies through `NODE_PATH`
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

If your code uses JSX, the corresponding runtime helpers, such as `react/jsx-runtime` or `react/jsx-dev-runtime`, must be resolvable from the workspace or from the action image.

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

`@actions/core` is not injected as a global. If you want it, import it explicitly from your script:

```ts
import * as core from '@actions/core'
```

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
