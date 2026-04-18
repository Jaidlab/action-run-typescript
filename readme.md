# action-run-typescript

Run inline TypeScript in GitHub Actions using Node.js 24.

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

Your inline code runs in a dedicated Node.js 24 child process from the workflow workspace root. These bindings are available without importing anything:

- `github` – a best-effort GitHub context built from `@actions/github.context`, plus compatibility aliases like `github.repository`, `github.run_id`, `github.event` and `github.repo`
- `job` – a best-effort job context. It always includes `job.id` from `GITHUB_JOB` and may also include `name`, `status`, `conclusion`, `workflow_job_id`, `workflowJobId` and `url`
- `runner` – a best-effort runner context built from runner environment variables and `@actions/core.platform`
- `matrix` – `{}` by default
- `strategy` – `{}` by default
- `steps` – `{}` by default or a best-effort fallback derived from the workflow jobs API
- `workflowJob` – best-effort metadata for the current workflow job, including its step list when available
- every top-level field from `with.globals` – these are assigned after the built-in bindings, so they can override names like `matrix`, `strategy` or `steps`
- standard Node globals such as `fetch`, `console`, `process`, `Buffer`, `URL` and friends

Bindings are injected during bundling and also assigned onto `globalThis` before your code runs, so bundled local modules can use either bare identifiers like `matrix` or explicit access like `globalThis.matrix`.

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

## Imports and bundling

The inline script is bundled with Rspack from the workspace root into a temporary module inside the workspace and then executed directly with Node. This means:

- relative imports behave as expected from the workspace root
- local `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` and `.json` files are bundled before execution
- inline TSX and local TSX or JSX imports are supported
- bare package imports stay external and resolve from the workspace at runtime
- the published action downloads the pinned platform-specific Rspack native binding into the runner temp directory on demand

Example:

```yml
- uses: Jaidlab/action-run-typescript@v0.1.0
  with:
    code: |-
      import packageJson from './package.json'
      import component from './src/component.tsx'
      console.dir({packageJson, component})
```

JSX and TSX use Rspack’s SWC-based React automatic runtime. If your code uses JSX, the corresponding runtime helpers, such as `react/jsx-runtime`, must be resolvable from the workspace.

## Using `@actions/core`

`@actions/core` is no longer injected as a global. If you want it, import it explicitly from your script:

```ts
import * as core from '@actions/core'
```

Because bare package imports stay external, that package must be resolvable from the runtime environment of your workflow.

## Notes

- GitHub context is gathered from the Actions toolkit instead of being passed through action inputs.
- `matrix`, `strategy` and the real `steps` context are not available directly through the Actions toolkit. Use `globals` when you need them.
- The inline script is bundled with Rspack, written to a temporary folder inside the workspace and then executed directly by Node in a dedicated child process.
- `GITHUB_TOKEN` is exposed to the script environment when available.
- The script runs from the workflow workspace root, not from the action repository.
- No Bun runtime is required in your workflow.
- The published action installs the pinned platform-specific Rspack native binding via npm into the runner temp directory on demand.
