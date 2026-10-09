import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const braces = require('braces')

describe('braces recursion guard', () => {
  it.each(['compile', 'expand', 'stringify', 'parse'])('rejects deeply nested patterns in %s', method => {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      const pattern = open.repeat(4000) + 'a' + close.repeat(4000)
      expect(() => braces[method](pattern)).toThrow(/maximum nesting depth/)
    }
  })

  it.each(['compile', 'expand', 'stringify'])('guards caller-supplied ASTs in %s', method => {
    let ast: any = { type: 'text', value: 'a' }
    for (let i = 0; i < 200; i++) ast = { type: 'root', nodes: [ast] }
    expect(() => braces[method](ast)).toThrow(/maximum nesting depth/)
  })

  it('preserves normal glob expansion and compilation', () => {
    expect(braces.expand('src/{app,lib}/**/*.{ts,tsx}')).toEqual([
      'src/app/**/*.ts', 'src/app/**/*.tsx', 'src/lib/**/*.ts', 'src/lib/**/*.tsx',
    ])
    expect(braces.compile('src/{app,lib}/*.ts')).toBe('src/(app|lib)/*.ts')
  })
})
