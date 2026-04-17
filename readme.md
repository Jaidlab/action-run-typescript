# action-run-typescript

Run inline TypeScript in GitHub Actions using Node.js 24.

## Usage

```yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: test
        uses: Jaidlab/action-run-typescript@v0.1.0
        with:
          code: |-
            console.log('hi')
            console.dir({env: process.env})
            console.dir({github, steps})
```

## Available bindings

Your inline code runs in a dedicated Node.js 24 child process from the workflow workspace root. The action itself is shipped as a bundled JavaScript action at `dist/action.js`; Bun is only used to build this repository.

These bindings are available without importing anything:

- `github` – the GitHub Actions `github` context
- `job` – the GitHub Actions `job` context
- `runner` – the GitHub Actions `runner` context
- `strategy` – the GitHub Actions `strategy` context
- `matrix` – the GitHub Actions `matrix` context
- `steps` – either the JSON passed through the action input or a best-effort fallback derived from the workflow jobs API
- `workflowJob` – best-effort metadata for the current workflow job, including its step list when available
- `core` – a lightweight helper inspired by `@actions/core`
- standard Node globals such as `fetch`, `console`, `process`, `Buffer`, `URL` and friends

## Passing the real `steps` context

GitHub does not expose the caller workflow’s `steps` context directly to JavaScript actions. If you want the full context, including step outputs, pass it explicitly:

```yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - id: prepare
        run: echo "value=42" >> "$GITHUB_OUTPUT"
      - uses: Jaidlab/action-run-typescript@v0.1.0
        with:
          steps: ${{ toJson(steps) }}
          code: |-
            console.dir(steps.prepare.outputs.value)
```

If you do not pass `steps`, the action still tries to populate `steps` and `workflowJob` from the GitHub Actions jobs API. That fallback is useful for introspection, but it cannot reconstruct step outputs. In that mode, `steps` is shaped like `{ $source, $job, $list, $byName, $byNumber, $bySlug }`.

## Relative imports

The inline script is evaluated as a workspace-rooted module, so relative imports behave as expected:

```yml
- uses: Jaidlab/action-run-typescript@v0.1.0
  with:
    code: |-
      import packageJson from './package.json'
      console.dir(packageJson)
```

Supported local imports include `.ts`, `.mts`, `.cts`, `.js`, `.mjs` and `.json`. JSON imports do not require import assertions. TSX/JSX is intentionally not supported.

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

- The inline script is evaluated through `vm.SourceTextModule` in a dedicated child Node process started with `--experimental-vm-modules`.
- `GITHUB_TOKEN` is exposed to the script environment when available.
- The script runs from the workflow workspace root, not from the action repository.
- No Bun runtime is required in your workflow.
