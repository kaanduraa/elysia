import { describe, expect, it } from 'bun:test'

import { mergeCookie } from '../../src/utils'

describe('mergeCookie', () => {
        it('merges cookie configuration without mutating inputs', () => {
                const base = { sameSite: 'lax' as const }
                const override = { httpOnly: true }

                const result = mergeCookie(base, override)

                expect(result).toEqual({
                        sameSite: 'lax',
                        httpOnly: true
                })
                expect(base).toEqual({ sameSite: 'lax' })
        })

        it('removes properties metadata from merged cookie config', () => {
                const result = mergeCookie(
                        {
                                properties: {
                                        secure: true
                                },
                                sameSite: 'strict' as const
                        },
                        {
                                properties: {
                                        httpOnly: true
                                },
                                path: '/app'
                        }
                )

                expect(result).toEqual({
                        sameSite: 'strict',
                        path: '/app'
                })
                expect('properties' in result).toBe(false)
        })
})
