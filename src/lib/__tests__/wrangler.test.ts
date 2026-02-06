import { describe, it, expect, vi } from 'vitest';
import { checkWranglerLogin } from '../wrangler';
import * as child_process from 'child_process';

vi.mock('child_process');

describe('checkWranglerLogin', () => {
    it('should detect logged in state', () => {
        vi.spyOn(child_process, 'execSync').mockReturnValue(
            'You are logged in with an OAuth Token, associated with the email test@example.com' as any
        );

        const result = checkWranglerLogin();

        expect(result.loggedIn).toBe(true);
        expect(result.account).toBe('test@example.com');
    });

    it('should detect logged out state', () => {
        vi.spyOn(child_process, 'execSync').mockImplementation(() => {
            throw new Error('Not logged in');
        });

        const result = checkWranglerLogin();

        expect(result.loggedIn).toBe(false);
    });

    it('should handle different login message formats', () => {
        vi.spyOn(child_process, 'execSync').mockReturnValue(
            'You are logged in' as any
        );

        const result = checkWranglerLogin();

        expect(result.loggedIn).toBe(true);
    });
});
