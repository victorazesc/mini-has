export function dpsIdFromCode(code: string): string {
    const feederDps: Record<string, string> = {
        meal_plan: '1',
        manual_feed: '3',
        feed_state: '4',
        factory_reset: '14',
        feed_report: '15',
    };
    if (feederDps[code]) return feederDps[code];
    if (code.startsWith('switch_') && /^\d+$/.test(code.replace('switch_', ''))) return code.replace('switch_', '');
    if (code === 'switch_led') return '20';
    if (code === 'switch') return '1';
    return code;
}
