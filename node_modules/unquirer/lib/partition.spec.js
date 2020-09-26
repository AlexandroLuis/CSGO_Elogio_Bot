'use strict'

const { test } = require('ava')
const { partition } = require('./partition')

test('partitions array', async t => {
  const expectedTruthy = [
    2,
    4
  ]
  const expectedFalsy = [
    1,
    3,
    5
  ]
  const list = [].concat(expectedTruthy, expectedFalsy)
  const { truthy, falsy } = partition(list, v => v % 2 === 0)
  t.deepEqual(truthy, expectedTruthy)
  t.deepEqual(falsy, expectedFalsy)
})
