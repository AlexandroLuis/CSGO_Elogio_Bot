'use strict'

function validateType (name, value, type) {
  if (['checkbox', 'list', 'rawlist'].includes(type) && !Array.isArray(value)) {
    throw new Error(`Expected ${name} to be an array`)
  }

  if (type === 'confirm' && typeof value !== 'boolean') {
    throw new Error(`Expected ${name} to be a boolean`)
  }
}

exports.validate = async function (args, questions) {
  return questions.reduce(async (curr, next) => {
    const { name, validate, filter, type } = next
    validateType(name, args[name], type)
    const result = validate ? await validate(args[name], curr) : true
    if (result === true) {
      curr[name] = filter ? await filter(args[name]) : args[name]
      return curr
    }
    throw new Error(result || `Property ${name} did not pass validation`)
  }, {})
}
