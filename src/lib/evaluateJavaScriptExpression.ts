export const evaluateJavaScriptExpression = <Value = unknown>(source: string) => {
  const evaluate = new Function(`"use strict"
return (
${source}
)`) as () => Value
  return evaluate()
}
