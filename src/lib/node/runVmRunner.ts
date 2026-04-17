import type {VmRunnerPayload} from './VmRunnerPayload.ts'

import {readFileSync} from 'node:fs'

import {createCore} from '../context/createCore.ts'
import {createGlobalValuesRecord} from '../context/createExecutionContext.ts'
import {VmModuleRuntime} from './VmModuleRuntime.ts'

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const parsePayload = (payloadFile: string): VmRunnerPayload => {
  const payload = JSON.parse(readFileSync(payloadFile, 'utf8')) as unknown
  if (!isRecord(payload)) {
    throw new TypeError('Invalid VM runner payload.')
  }
  if (!isRecord(payload.bindings)) {
    throw new TypeError('Invalid VM runner bindings payload.')
  }
  if (!isRecord(payload.globals)) {
    throw new TypeError('Invalid VM runner globals payload.')
  }
  if (typeof payload.identifier !== 'string' || !payload.identifier) {
    throw new TypeError('Invalid VM runner module identifier.')
  }
  return payload as VmRunnerPayload
}
const getRequiredArgument = (value: string | undefined, label: string) => {
  if (!value) {
    throw new Error(`Missing ${label}.`)
  }
  return value
}

export const runVmRunner = async (payloadFile = process.argv[2], bundleFile = process.argv[3]) => {
  const resolvedPayloadFile = getRequiredArgument(payloadFile, 'VM runner payload file path')
  const resolvedBundleFile = getRequiredArgument(bundleFile, 'VM runner bundle file path')
  const payload = parsePayload(resolvedPayloadFile)
  const bundle = readFileSync(resolvedBundleFile, 'utf8')
  const runtime = new VmModuleRuntime({
    code: bundle,
    globalValues: createGlobalValuesRecord({
      ...payload.bindings,
      core: createCore(),
    }, payload.globals),
    identifier: payload.identifier,
  })
  await runtime.evaluate()
}
