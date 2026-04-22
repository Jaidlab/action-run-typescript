type QuoteCharacter = '"' | '\''

export const splitShellStyleArguments = (value: string) => {
  const argumentsList: Array<string> = []
  let currentArgument = ''
  let currentQuote: QuoteCharacter | undefined
  let isEscaping = false
  let hasStartedArgument = false
  const pushCurrentArgument = () => {
    if (!hasStartedArgument) {
      return
    }
    argumentsList.push(currentArgument)
    currentArgument = ''
    hasStartedArgument = false
  }
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (isEscaping) {
      currentArgument += character
      hasStartedArgument = true
      isEscaping = false
      continue
    }
    if (currentQuote) {
      if (character === currentQuote) {
        currentQuote = undefined
        continue
      }
      if (character === '\\' && currentQuote === '"') {
        if (index < value.length - 1) {
          currentArgument += value[index + 1]
          hasStartedArgument = true
          index++
          continue
        }
      }
      currentArgument += character
      hasStartedArgument = true
      continue
    }
    if (character === '\\') {
      isEscaping = true
      hasStartedArgument = true
      continue
    }
    if (character === '\'' || character === '"') {
      currentQuote = character
      hasStartedArgument = true
      continue
    }
    if (/\s/.test(character)) {
      pushCurrentArgument()
      continue
    }
    currentArgument += character
    hasStartedArgument = true
  }
  if (currentQuote) {
    throw new SyntaxError('Unterminated quoted string in shell-style arguments.')
  }
  if (isEscaping) {
    currentArgument += '\\'
  }
  pushCurrentArgument()
  return argumentsList
}
