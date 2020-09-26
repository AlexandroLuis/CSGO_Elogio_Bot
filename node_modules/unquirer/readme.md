## Unquirer

A wrapper for [Inquirer](https://www.npmjs.com/package/inquirer) to allow pre-answering questions with command line arguments

### Installation

This library has a peer dependency of inquirer, so make sure you also install it.

```bash
  npm install --save unquirer inquirer
```

### Usage

Given the following highly opinionated version of the inquirer 'input' example, to demonstrate `filter` and `validate` support:

```javascript
  const unquirer = require('unquirer')

  var questions = [
    {
      type: 'input',
      name: 'firstName',
      message: "What's your first name"
    },
    {
      type: 'input',
      name: 'lastName',
      message: 'What's your last name',
      filter: answer => {
        return 'Smith'
      }
    },
    {
      type: 'input',
      name: 'favColor',
      message: "What's your favorite color",
      validate: answer => {
        if (answer === 'yellow') { return true }
        return "You can only like yellow!"
      }
    }
  ]

  async function go () {
    const answers = await unquirer.prompt(questions)
    console.log(JSON.stringify(answers, null, '  '))
  }

  go()
```

You could call this program in the regular way, to be prompted for all the questions:

```bash
  node input.js
```

Or, you could pass some of the answers in, and only be prompted about favColor:

```bash
  node input.js --firstName="Jim" --lastName="Smith"
```

Or you can pass in all the answers, totally non-interactive:

```bash
  node input.js --firstName="Jim" --lastName="Smith" --favColor="yellow"
```

### Options

Options are passed as the second parameter to the `unquirer.prompt` method.

There is currently only one option, `useCamelCase`, which defaults to true. This pption causes parameters like `--some-param` to result in the answer key `someParam`. In order to preserve dashes in your `question` `name`s, pass `{ useCamelCase: false }` as options.

### Validation

Validation works the same as it does in Inquirer, i.e. in your validation method, return `true` to pass validation, return `false` to fail with a default message, and return any `string` to fail with that specific message.