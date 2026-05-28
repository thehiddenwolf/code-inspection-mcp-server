export function posFromIndex(content: string, lines: string[], idx: number): { line: number; column: number } {
  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length + 1; // +1 for newline
    if (idx < lineLen) {
      return { line: i + 1, column: idx + 1 };
    }
    idx -= lineLen;
  }
  return { line: lines.length || 1, column: 1 };
}

export function cleanSqlName(name: string): string {
  return name.replace(/['"`]/g, '').trim();
}
