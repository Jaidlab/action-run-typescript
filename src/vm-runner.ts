import type {VmRunnerPayload} from './lib/node/NodeModuleRunner.ts'

import {readFileSync} from 'node:fs'
import path from 'node:path'

import * as actionCore from '@actions/core'

import {VmModuleRuntime} from './lib/node/VmModuleRuntime.ts'

const entryPath = import.meta.filename
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const createGlobalValues = (payload: VmRunnerPayload) => Object.assign(Object.create(null), payload.bindings, {core: actionCore}, payload.globals) as Record<string, unknown>
const getRequiredArgument = (value: string | undefined, label: string) => {
  if (!value) {
    throw new Error(`Missing ${label}.`)
  }
  return value
}
const isMainModule = () => {
  const mainModulePath = process.argv[1]
  if (!mainModulePath) {
    return false
  }
  return path.resolve(mainModulePath) === entryPath
}
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

export const runVmRunner = async (payloadFile = process.argv[2], bundleFile = process.argv[3]) => {
  const resolvedPayloadFile = getRequiredArgument(payloadFile, 'VM runner payload file path')
  const resolvedBundleFile = getRequiredArgument(bundleFile, 'VM runner bundle file path')
  const payload = parsePayload(resolvedPayloadFile)
  const runtime = new VmModuleRuntime({
    code: readFileSync(resolvedBundleFile, 'utf8'),
    globalValues: createGlobalValues(payload),
    identifier: payload.identifier,
  })
  await runtime.evaluate()
}

export default runVmRunner

if (isMainModule()) {
  await runVmRunner()
}
