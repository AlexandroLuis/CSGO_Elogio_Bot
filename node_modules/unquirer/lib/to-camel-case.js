'use strict'

exports.toCamelCase = function (input) {
  const keys = Object.keys(input)
  return keys.reduce((curr, next) => {
    const newKey = next.replace(/(\-\w)/g, m => { return m[1].toUpperCase() })
    curr[newKey] = input[next]
    return curr
  }, {})
}