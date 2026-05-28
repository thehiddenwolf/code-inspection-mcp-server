/**
 * Output formatting utility for CLI commands.
 * Supports json, pretty, and ci output modes.
 */

export function formatOutput<T>(data: T, format: 'json' | 'pretty' | 'ci'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'pretty':
      return formatPretty(data);
    case 'ci':
      return formatCi(data);
    default:
      return JSON.stringify(data, null, 2);
  }
}

function formatPretty<T>(data: T): string {
  if (Array.isArray(data)) {
    return data.map(item => formatPretty(item)).join('\n---\n');
  }
  if (data !== null && typeof data === 'object') {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === 'object' && value !== null) {
        lines.push(`${key}:`);
        lines.push(indent(formatPretty(value), 2));
      } else {
        lines.push(`${key}: ${String(value)}`);
      }
    }
    return lines.join('\n');
  }
  return String(data);
}

function formatCi<T>(data: T): string {
  if (data !== null && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    return entries
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return `${key}=${JSON.stringify(value)}`;
        }
        return `${key}=${String(value)}`;
      })
      .join('\n');
  }
  return String(data);
}

function indent(str: string, spaces: number): string {
  const padding = ' '.repeat(spaces);
  return str
    .split('\n')
    .map(line => padding + line)
    .join('\n');
}
