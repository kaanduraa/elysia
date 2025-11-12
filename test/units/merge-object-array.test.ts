import { describe, expect, it } from 'bun:test'

import { mergeObjectArray } from '../../src/utils'
import type { HookContainer } from '../../src/types'

describe('mergeObjectArray', () => {
        const makeHook = (checksum: number | undefined, label: string): HookContainer => ({
                checksum,
                fn: () => label
        })

        it('returns undefined when both sources are undefined', () => {
                const result = mergeObjectArray(undefined, undefined)

                expect(result).toBeUndefined()
        })

        it('merges unique hooks while preserving order', () => {
                const first = makeHook(1, 'first')
                const second = makeHook(2, 'second')

                const result = mergeObjectArray(first, second)

                expect(result).toEqual([first, second])
        })

        it('deduplicates hooks that share the same checksum', () => {
                const existing = makeHook(42, 'existing')
                const duplicate = makeHook(42, 'duplicate')
                const unique = makeHook(7, 'unique')

                const result = mergeObjectArray([existing], [duplicate, unique])

                expect(result).toEqual([existing, unique])
        })
})
