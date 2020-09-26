'use strict'

const inquirer = require('inquirer')
const { partition } = require('./partition')
const { validate } = require('./validator')
const { toCamelCase } = require('./to-camel-case')

function getAnswers (questions, input, options) {
  return options.useCamelCase ? toCamelCase(input) : input
}

exports.unquire = async function (questions, input, options = { useCamelCase: true }) {
  const answers = getAnswers(questions, input, options)
  const { truthy, falsy } = partition(questions, question => Object.keys(answers).includes(question.name))
  const interactiveAnswers = await inquirer.prompt(falsy)
  const providedAnswers = await validate(answers, truthy)
  return Object.assign({}, providedAnswers, interactiveAnswers)
}
