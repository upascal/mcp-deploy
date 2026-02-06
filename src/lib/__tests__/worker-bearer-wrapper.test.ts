import { describe, it, expect } from 'vitest';
import { generateBearerTokenWrapper } from '../worker-bearer-wrapper';

describe('generateBearerTokenWrapper', () => {
    it('should generate valid JavaScript module', () => {
        const wrapper = generateBearerTokenWrapper('TestMCP');
        expect(wrapper).toContain('export { TestMCP }');
        expect(wrapper).toContain('import OriginalWorker from');
    });

    it('should include bearer token validation', () => {
        const wrapper = generateBearerTokenWrapper('TestMCP');
        expect(wrapper).toContain('BEARER_TOKEN');
        expect(wrapper).toContain('Authorization');
    });

    it('should support URL token path', () => {
        const wrapper = generateBearerTokenWrapper('TestMCP');
        expect(wrapper).toContain('/mcp/t/');
    });

    it('should support bearer header', () => {
        const wrapper = generateBearerTokenWrapper('TestMCP');
        expect(wrapper).toContain('Bearer');
    });

    it('should re-export Durable Object class', () => {
        const wrapper = generateBearerTokenWrapper('ZoteroMCP');
        expect(wrapper).toContain('export { ZoteroMCP }');
    });

    it('should include health check endpoint', () => {
        const wrapper = generateBearerTokenWrapper('TestMCP');
        expect(wrapper).toContain("url.pathname === '/'");
        expect(wrapper).toContain('status: \'ok\'');
    });

    it('should handle URL token path rewriting', () => {
        const wrapper = generateBearerTokenWrapper('TestMCP');
        expect(wrapper).toContain('rewrittenPath');
        expect(wrapper).toContain('rewrittenUrl');
    });

    it('should return 401 for unauthorized requests', () => {
        const wrapper = generateBearerTokenWrapper('TestMCP');
        expect(wrapper).toContain('status: 401');
        expect(wrapper).toContain('Unauthorized');
    });
});
