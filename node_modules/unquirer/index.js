'use strict'

const args = require('args-parser')
const { unquire } = require('./lib/unquirer')
const argv = args(process.argv)

exports.prompt = function (questions, options) {
  return unquire(questions, argv, options)
}