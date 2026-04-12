import {expect, it} from 'bun:test'

import {getMainModuleDefault} from 'zeug'

const actionRunTypescript = await getMainModuleDefault<typeof import('action-run-typescript')>('action-run-typescript')

it('should run', () => {
  expect(actionRunTypescript).toBe(1) // TODO Test actual functionality
})
