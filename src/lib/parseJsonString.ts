export const parseJsonString = <Value>(rawValue: string | undefined, name = 'JSON value'): Value | undefined => {
  if (rawValue === undefined || rawValue === '') {
    return undefined
  }
  try {
    return JSON.parse(rawValue) as Value
  } catch (error) {
    throw new Error(`Failed to parse ${name}.`, {cause: error})
  }
}
