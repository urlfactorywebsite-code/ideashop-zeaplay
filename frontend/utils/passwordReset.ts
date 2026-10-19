export function passwordError(password: string, confirmation: string): string | null {
    if (password !== confirmation) return 'Passwords do not match.';
    if (Array.from(password).length < 8) return 'Password must be at least 8 characters long.';
    if (new TextEncoder().encode(password).length > 72) return 'Password must be at most 72 UTF-8 bytes.';
    return null;
}
