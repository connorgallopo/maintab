const SHAPE = /^[\w.-]+\/[\w.-]+$/;

export function parseRepo(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^https:\/\/github\.com\//, '');
  s = s.replace(/\.git$/, '').replace(/\/+$/, '');
  return SHAPE.test(s) ? s : null;
}
