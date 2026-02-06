import type { TestSpec } from "./types";

export interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Substitute placeholders in a string with values.
 * {{value}} is replaced with the current field value.
 * {{FIELD_KEY}} is replaced with the value of that field from allValues.
 */
function substitutePlaceholders(
  template: string,
  value: string,
  allValues: Record<string, string>,
  urlEncode: boolean = false
): string {
  let result = template.replace(
    "{{value}}",
    urlEncode ? encodeURIComponent(value) : value
  );

  for (const [key, val] of Object.entries(allValues)) {
    result = result.replace(
      `{{${key}}}`,
      urlEncode ? encodeURIComponent(val) : val
    );
  }

  return result;
}

/**
 * Run a test spec against an external API.
 *
 * @param spec - The test specification from mcp-deploy.json
 * @param value - The current field's value (substituted for {{value}})
 * @param allValues - All form values (for {{FIELD_KEY}} substitution)
 */
export async function runTest(
  spec: TestSpec,
  value: string,
  allValues: Record<string, string>
): Promise<TestResult> {
  try {
    // Substitute placeholders in URL (with URL encoding)
    const url = substitutePlaceholders(spec.url, value, allValues, true);

    // Substitute placeholders in headers (no URL encoding)
    const headers: Record<string, string> = {};
    if (spec.headers) {
      for (const [headerKey, headerVal] of Object.entries(spec.headers)) {
        headers[headerKey] = substitutePlaceholders(
          headerVal,
          value,
          allValues,
          false
        );
      }
    }

    // Substitute placeholders in body if present
    let body: string | undefined;
    if (spec.body) {
      body = substitutePlaceholders(spec.body, value, allValues, false);
    }

    // Make the request
    const response = await fetch(url, {
      method: spec.method,
      headers,
      body,
    });

    // Check for success
    if (spec.success.includes(response.status)) {
      return { success: true, message: "Connection successful" };
    }

    // Check for known error
    const errorMessage = spec.errors?.[response.status];
    if (errorMessage) {
      return { success: false, error: errorMessage };
    }

    // Unknown error
    return {
      success: false,
      error: `API returned status ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
