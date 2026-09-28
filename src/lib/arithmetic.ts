/**
 * Evaluates simple arithmetic typed into a number field: + - * / (also × ÷), parentheses,
 * decimals and unary minus. Returns null for anything else or a non-finite result.
 */
export const evaluateArithmetic = (input: string): number | null => {
  const source = input.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '.');
  if (source === '') return null;
  let position = 0;

  const peek = () => source[position];

  const parseNumber = (): number | null => {
    const match = /^(\d+\.?\d*|\.\d+)/.exec(source.slice(position));
    if (!match) return null;
    position += match[0].length;
    return Number(match[0]);
  };

  const parseFactor = (): number | null => {
    if (peek() === '-' || peek() === '+') {
      const sign = source[position++] === '-' ? -1 : 1;
      const value = parseFactor();
      return value === null ? null : sign * value;
    }
    if (peek() === '(') {
      position += 1;
      const value = parseExpression();
      if (value === null || peek() !== ')') return null;
      position += 1;
      return value;
    }
    return parseNumber();
  };

  const parseTerm = (): number | null => {
    let value = parseFactor();
    while (value !== null && (peek() === '*' || peek() === '/')) {
      const operator = source[position++];
      const right = parseFactor();
      if (right === null) return null;
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };

  function parseExpression(): number | null {
    let value = parseTerm();
    while (value !== null && (peek() === '+' || peek() === '-')) {
      const operator = source[position++];
      const right = parseTerm();
      if (right === null) return null;
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  if (result === null || position !== source.length || !Number.isFinite(result)) return null;
  return result;
};
