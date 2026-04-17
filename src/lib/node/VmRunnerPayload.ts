import type {ActionRuntimeBindings} from '../ActionRuntimeBindings.ts'

export interface VmRunnerPayload {
  readonly bindings: ActionRuntimeBindings
  readonly globals: Record<string, unknown>
  readonly identifier: string
}
