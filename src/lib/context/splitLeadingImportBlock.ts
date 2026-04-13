const isIdentifierCharacter = (character: string) => /[$0-9A-Z_a-z]/.test(character)
const hasWordAt = (value: string, index: number, word: string) => value.slice(index, index + word.length) === word && !isIdentifierCharacter(value[index - 1] || '') && !isIdentifierCharacter(value[index + word.length] || '')
const consumeWhitespaceAndComments = (value: string, startIndex: number) => {
  let index = startIndex
  while (index < value.length) {
    const character = value[index]
    if (/\s/.test(character)) {
      index++
      continue
    }
    if (value.startsWith('//', index)) {
      index += 2
      while (index < value.length && value[index] !== '\n') {
        index++
      }
      continue
    }
    if (value.startsWith('/*', index)) {
      const commentEnd = value.indexOf('*/', index + 2)
      if (commentEnd === -1) {
        return value.length
      }
      index = commentEnd + 2
      continue
    }
    break
  }
  return index
}
const consumeStringLiteral = (value: string, startIndex: number) => {
  const quote = value[startIndex]
  let index = startIndex + 1
  while (index < value.length) {
    const character = value[index]
    if (character === '\\') {
      index += 2
      continue
    }
    if (character === quote) {
      return index + 1
    }
    index++
  }
  return index
}
const consumeBalancedBraceBlock = (value: string, startIndex: number) => {
  let braceDepth = 0
  let index = startIndex
  while (index < value.length) {
    if (value.startsWith('//', index)) {
      index += 2
      while (index < value.length && value[index] !== '\n') {
        index++
      }
      continue
    }
    if (value.startsWith('/*', index)) {
      const commentEnd = value.indexOf('*/', index + 2)
      if (commentEnd === -1) {
        return value.length
      }
      index = commentEnd + 2
      continue
    }
    const character = value[index]
    if (character === '\'' || character === '"') {
      index = consumeStringLiteral(value, index)
      continue
    }
    if (character === '{') {
      braceDepth++
      index++
      continue
    }
    if (character === '}') {
      braceDepth--
      index++
      if (braceDepth === 0) {
        return index
      }
      continue
    }
    index++
  }
  return index
}
const consumeImportAttributes = (value: string, startIndex: number) => {
  let index = consumeWhitespaceAndComments(value, startIndex)
  for (const keyword of ['with', 'assert']) {
    if (!hasWordAt(value, index, keyword)) {
      continue
    }
    index += keyword.length
    index = consumeWhitespaceAndComments(value, index)
    if (value[index] !== '{') {
      return index
    }
    return consumeWhitespaceAndComments(value, consumeBalancedBraceBlock(value, index))
  }
  return index
}
const consumeImportStatement = (value: string, startIndex: number) => {
  if (!hasWordAt(value, startIndex, 'import')) {
    return
  }
  let index = consumeWhitespaceAndComments(value, startIndex + 'import'.length)
  const nextCharacter = value[index]
  if (nextCharacter === '(' || nextCharacter === '.') {
    return
  }
  if (nextCharacter === '\'' || nextCharacter === '"') {
    index = consumeStringLiteral(value, index)
    index = consumeImportAttributes(value, index)
    if (value[index] === ';') {
      index++
    }
    return consumeWhitespaceAndComments(value, index)
  }
  let braceDepth = 0
  let bracketDepth = 0
  let parenthesisDepth = 0
  while (index < value.length) {
    if (value.startsWith('//', index)) {
      index += 2
      while (index < value.length && value[index] !== '\n') {
        index++
      }
      continue
    }
    if (value.startsWith('/*', index)) {
      const commentEnd = value.indexOf('*/', index + 2)
      if (commentEnd === -1) {
        return
      }
      index = commentEnd + 2
      continue
    }
    const character = value[index]
    if (character === '\'' || character === '"') {
      index = consumeStringLiteral(value, index)
      continue
    }
    if (character === '{') {
      braceDepth++
      index++
      continue
    }
    if (character === '}') {
      braceDepth--
      index++
      continue
    }
    if (character === '[') {
      bracketDepth++
      index++
      continue
    }
    if (character === ']') {
      bracketDepth--
      index++
      continue
    }
    if (character === '(') {
      parenthesisDepth++
      index++
      continue
    }
    if (character === ')') {
      parenthesisDepth--
      index++
      continue
    }
    if (braceDepth === 0 && bracketDepth === 0 && parenthesisDepth === 0 && hasWordAt(value, index, 'from')) {
      index += 'from'.length
      index = consumeWhitespaceAndComments(value, index)
      if (value[index] !== '\'' && value[index] !== '"') {
        return
      }
      index = consumeStringLiteral(value, index)
      index = consumeImportAttributes(value, index)
      if (value[index] === ';') {
        index++
      }
      return consumeWhitespaceAndComments(value, index)
    }
    index++
  }
}

export interface ImportBlockSplit {
  readonly body: string
  readonly imports: string
}

export const splitLeadingImportBlock = (code: string): ImportBlockSplit => {
  let cursor = 0
  let importBlockEnd = 0
  while (true) {
    const importStart = consumeWhitespaceAndComments(code, cursor)
    const importEnd = consumeImportStatement(code, importStart)
    if (importEnd === undefined) {
      break
    }
    cursor = importEnd
    importBlockEnd = importEnd
  }
  return {
    imports: importBlockEnd ? code.slice(0, importBlockEnd) : '',
    body: importBlockEnd ? code.slice(importBlockEnd) : code,
  }
}
