import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const braces = require('braces')
const forge = require('node-forge')

test('braces rejects excessive brace/parenthesis nesting in all public walkers', () => {
  for (const method of ['parse', 'compile', 'expand', 'stringify']) {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      const pattern = open.repeat(4000) + 'a' + close.repeat(4000)
      assert.throws(() => braces[method](pattern), /maximum nesting depth/)
    }
  }
  assert.deepEqual(braces.expand('src/{a,b}/*.ts'), ['src/a/*.ts', 'src/b/*.ts'])
})

test('braces also bounds caller-supplied ASTs', () => {
  for (const method of ['compile', 'expand', 'stringify']) {
    let ast = { type: 'text', value: 'a' }
    for (let i = 0; i < 200; i++) ast = { type: 'root', nodes: [ast] }
    assert.throws(() => braces[method](ast), /maximum nesting depth/)
  }
})

test('RSA verification rejects extra DigestAlgorithm children while accepting valid signatures', () => {
  // Ephemeral test key; no deployed credentials or certificates are involved.
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  const digest = forge.md.sha256.create().update('security regression')
  const bytes = digest.digest().getBytes()
  assert.equal(keys.publicKey.verify(bytes, keys.privateKey.sign(digest)), true)

  const { asn1 } = forge
  const sequence = children => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, children)
  const algorithm = sequence([
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(forge.pki.oids.sha256).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, 'garbage'),
  ])
  const malformed = sequence([
    algorithm,
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, bytes),
  ])
  const signature = keys.privateKey.sign(asn1.toDer(malformed).getBytes(), 'NONE')
  assert.throws(() => keys.publicKey.verify(bytes, signature), /valid RSASSA-PKCS1/)
})

test('patched image-size remains compatible with Metro buffers and asset files', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDkcAAAAASUVORK5CYII=', 'base64')
  const expoRequire = createRequire(require.resolve('@expo/metro/package.json'))
  const directory = mkdtempSync(join(tmpdir(), 'metro-security-test-'))
  const file = join(directory, 'tiny.png')
  writeFileSync(file, png)
  try {
    for (const load of [require, expoRequire]) {
      const { getAssetSize, getAssetData } = load('metro/private/Assets')
      assert.deepEqual(getAssetSize('png', png, 'tiny.png'), { width: 1, height: 1 })
      const asset = await getAssetData(file, 'tiny.png', [], null, '/assets')
      assert.equal(asset.width, 1)
      assert.equal(asset.height, 1)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('query-string remains compatible with the updated URI decoder', () => {
  const queryString = require('query-string')
  assert.deepEqual({ ...queryString.parse('q=%E2%9C%93&label=hello%20world') }, {
    q: '✓', label: 'hello world',
  })
})
