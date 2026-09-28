import { describe, expect, it } from 'vitest';
import { evaluateArithmetic } from './arithmetic';

describe('evaluateArithmetic', () => {
  it('reads plain numbers', () => {
    expect(evaluateArithmetic('450')).toBe(450);
    expect(evaluateArithmetic(' 12.5 ')).toBe(12.5);
  });

  it('applies + - * / with precedence', () => {
    expect(evaluateArithmetic('1200/2')).toBe(600);
    expect(evaluateArithmetic('100+50*2')).toBe(200);
    expect(evaluateArithmetic('1920 - 20')).toBe(1900);
    expect(evaluateArithmetic('1080*16/9')).toBe(1920);
  });

  it('handles parentheses, unary minus and × ÷', () => {
    expect(evaluateArithmetic('(100+50)*2')).toBe(300);
    expect(evaluateArithmetic('-5+10')).toBe(5);
    expect(evaluateArithmetic('640×2')).toBe(1280);
    expect(evaluateArithmetic('1280÷2')).toBe(640);
  });

  it('rejects incomplete or invalid input', () => {
    expect(evaluateArithmetic('')).toBeNull();
    expect(evaluateArithmetic('450/')).toBeNull();
    expect(evaluateArithmetic('(1+2')).toBeNull();
    expect(evaluateArithmetic('1/0')).toBeNull();
    expect(evaluateArithmetic('abc')).toBeNull();
    expect(evaluateArithmetic('2**3')).toBeNull();
  });
});
