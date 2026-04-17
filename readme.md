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

- `core` – a lightweight helper inspired by `@actions/core`
- `github` – a best-effort GitHub context built from `@actions/github.context`, plus compatibility aliases like `github.repository`, `github.run_id`, `github.event` and `github.repo`
- `job` – a best-effort job context. It always includes `job.id` from `GITHUB_JOB` and may also include `name`, `status`, `conclusion`, `workflow_job_id`, `workflowJobId` and `url`
- `runner` – a best-effort runner context built from runner environment variables and `@actions/core.platform`
- `matrix` – `{}` by default
- `strategy` – `{}` by default
- `steps` – `{}` by default or a best-effort fallback derived from the workflow jobs API
- `workflowJob` – best-effort metadata for the current workflow job, including its step list when available
- every top-level field from `with.globals` – these are assigned after the built-in bindings, so they can override names like `matrix`, `strategy`, `steps` or even `core`
- standard Node globals such as `fetch`, `console`, `process`, `Buffer`, `URL` and friends

Because the bindings are real globals in the VM context, bundled local modules can use them too.

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

The inline script is first bundled with Rspack from the workspace root and then evaluated in the VM. This means:

- relative imports behave as expected from the workspace root
- local `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` and `.json` files are bundled before execution
- inline TSX and local TSX or JSX imports are supported
- bare package imports stay external and resolve from the workspace at runtime

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

## `core` helper

The injected `core` object supports a practical subset of `@actions/core`:

- `core.setOutput(name, value)`
- `core.exportVariable(name, value)`
- `core.saveState(name, value)`
- `core.getState(name)`
- `core.addPath(path)`
- `core.setSecret(secret)`
- `core.debug(message)`
- `core.info(message)`
- `core.notice(message, properties?)`
- `core.warning(message, properties?)`
- `core.error(message, properties?)`
- `core.setFailed(message)`
- `core.startGroup(name)`
- `core.endGroup()`
- `core.group(name, callback)`
- `core.summary.append(value)`
- `core.summary.write(value)`
- `core.summary.clear()`

## Notes

- GitHub context is gathered from the Actions toolkit instead of being passed through action inputs.
- `matrix`, `strategy` and the real `steps` context are not available directly through the Actions toolkit. Use `globals` when you need them.
- The inline script is bundled with Rspack and then evaluated through `vm.SourceTextModule` in a dedicated child Node process started with `--experimental-vm-modules`.
- `GITHUB_TOKEN` is exposed to the script environment when available.
- The script runs from the workflow workspace root, not from the action repository.
- No Bun runtime is required in your workflow.
