export function dpsIdFromCode(code: string): string {
    if (code.startsWith('switch_') && /^\d+$/.test(code.replace('switch_', ''))) return code.replace('switch_', '');
    if (code === 'switch' || code === 'switch_led') return '1';
    return code;
}
