'use strict'

const { test } = require('ava')
const { unquire } = require('./unquirer')

test('with no args', async t => {
  const questions = [
    {
      name: 'stuff'
    }
  ]
  t.deepEqual(await unquire(questions, { stuff: 'xxx' }), { stuff: 'xxx' })
})
