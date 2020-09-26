'use strict'

const { test } = require('ava')
const { validate } = require('./validator')

test('passes validation', async t => {
  const args = { foo: 'bar' }
  const questions = [
    { name: 'foo', type: 'input', validate: answer => answer === 'bar' }
  ]
  t.truthy(await validate(args, questions))
})

test('no validation', async t => {
  const args = { foo: 'bar' }
  const questions = [
    { name: 'foo', type: 'input' }
  ]
  t.truthy(await validate(args, questions))
})

test('fails validation without specific reason', async t => {
  const args = { foo: 'bar' }
  const questions = [
    { name: 'foo', type: 'input', validate: answer => answer === 'abc' }
  ]
  const error = await t.throws(validate(args, questions))
  t.is(error.message, 'Property foo did not pass validation')
})

test('fails validation without specific reason', async t => {
  const args = { foo: 'bar' }
  const questions = [
    { name: 'foo', type: 'input', validate: answer => 'some problem' }
  ]
  const error = await t.throws(validate(args, questions))
  t.is(error.message, 'some problem')
})

async function typeValidation (t, input) {
  const args = { foo: input.value }
  const questions = [
    { name: 'foo', type: input.expectedType }
  ]
  const error = await t.throws(validate(args, questions))
}
typeValidation.title = (providedTitle, input) => `fails validation because ${input.value} is not ${input.expectedType}`

test(typeValidation, { value: 'xxx', expectedType: 'confirm' })
test(typeValidation, { value: 'xxx', expectedType: 'list' })
test(typeValidation, { value: 'xxx', expectedType: 'rawlist' })
test(typeValidation, { value: 'xxx', expectedType: 'checkbox' })

test('filters result', async t => {
  const args = { foo: 'bar' }
  const questions = [
    {
      name: 'foo',
      type: 'input',
      filter: answer => answer.split('').reverse().join('')
    }
  ]
  const answers = await validate(args, questions)
  t.is(answers.foo, 'rab')
})