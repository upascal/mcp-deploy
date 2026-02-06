import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchMcpMetadata, validateGitHubRepo } from '../github-releases';

// Mock fetch globally
global.fetch = vi.fn() as any;

describe('fetchMcpMetadata', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch metadata from latest release', async () => {
        const mockRelease = {
            tag_name: 'v1.0.0',
            assets: [
                { name: 'mcp-deploy.json', browser_download_url: 'https://example.com/metadata.json' },
                { name: 'worker.mjs', browser_download_url: 'https://example.com/worker.mjs' },
            ],
        };

        const mockMetadata = {
            name: 'Test MCP',
            description: 'Test description',
            version: '1.0.0',
            worker: {
                name: 'test-mcp',
                durableObjectBinding: 'MCP_OBJECT',
                durableObjectClassName: 'TestMCP',
                compatibilityDate: '2025-01-01',
                compatibilityFlags: ['nodejs_compat'],
                migrationTag: 'v1',
            },
            secrets: [],
            config: [],
            autoSecrets: ['BEARER_TOKEN'],
        };

        (global.fetch as any)
            .mockResolvedValueOnce({ ok: true, json: async () => mockRelease })
            .mockResolvedValueOnce({ ok: true, json: async () => mockMetadata });

        const result = await fetchMcpMetadata('owner/repo');

        expect(result.metadata.name).toBe('Test MCP');
        expect(result.version).toBe('v1.0.0');
        expect(result.bundleUrl).toBe('https://example.com/worker.mjs');
    });

    it('should throw error if metadata missing', async () => {
        const mockRelease = {
            tag_name: 'v1.0.0',
            assets: [
                { name: 'worker.mjs', browser_download_url: 'https://example.com/worker.mjs' },
            ],
        };

        (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => mockRelease });

        await expect(fetchMcpMetadata('owner/repo')).rejects.toThrow('missing mcp-deploy.json');
    });

    it('should throw error if bundle missing', async () => {
        const mockRelease = {
            tag_name: 'v1.0.0',
            assets: [
                { name: 'mcp-deploy.json', browser_download_url: 'https://example.com/metadata.json' },
            ],
        };

        (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => mockRelease });

        await expect(fetchMcpMetadata('owner/repo')).rejects.toThrow('missing worker.mjs');
    });
});

describe('validateGitHubRepo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should validate repo with proper releases', async () => {
        const mockRelease = {
            tag_name: 'v1.0.0',
            assets: [
                { name: 'mcp-deploy.json', browser_download_url: 'https://example.com/metadata.json' },
                { name: 'worker.mjs', browser_download_url: 'https://example.com/worker.mjs' },
            ],
        };

        (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => mockRelease });

        const result = await validateGitHubRepo('owner/repo');

        expect(result.valid).toBe(true);
        expect(result.hasReleases).toBe(true);
        expect(result.hasMcpDeployJson).toBe(true);
        expect(result.latestVersion).toBe('v1.0.0');
    });

    it('should detect missing metadata', async () => {
        const mockRelease = {
            tag_name: 'v1.0.0',
            assets: [
                { name: 'worker.mjs', browser_download_url: 'https://example.com/worker.mjs' },
            ],
        };

        (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => mockRelease });

        const result = await validateGitHubRepo('owner/repo');

        expect(result.valid).toBe(false);
        expect(result.error).toContain('missing mcp-deploy.json');
    });

    it('should handle fetch errors', async () => {
        (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

        const result = await validateGitHubRepo('owner/repo');

        expect(result.valid).toBe(false);
        expect(result.hasReleases).toBe(false);
    });
});
