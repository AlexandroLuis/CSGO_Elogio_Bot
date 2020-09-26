'use strict'

const { test } = require('ava')
const { toCamelCase } = require('./to-camel-case')

test('converts snake-case to camelCase', async t => {
  const args = { 'snake-var': 'stuff' }
  t.deepEqual(toCamelCase(args), { snakeVar: 'stuff' })
})
