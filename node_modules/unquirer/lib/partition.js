'use strict'

exports.partition = function (list, discriminator) {
  return list.reduce((curr, next) => {
    const destination = discriminator(next) ? 'truthy' : 'falsy'
    curr[destination].push(next)
    return curr
  }, { truthy: [], falsy: [] })
}
