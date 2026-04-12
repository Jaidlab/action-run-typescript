export const serializeCodeLiteral = (value: unknown) => {
  if (value === undefined) {
    return 'undefined'
  }
  return JSON.stringify(value, null, 2)
}
