/**
 * GitHub Integration Constants
 *
 * Configuration for the GitHub bot integration feature.
 */

export const GITHUB_INTEGRATION = {
  // Feature flag to show/hide the GitHub integration toggle
  ENABLED: true,

  // Default state for the toggle (true = enabled by default)
  DEFAULT_ENABLED: true,

  // Regex to validate GitHub PR URLs
  PR_URL_REGEX: /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/,

  // Tooltip text explaining the feature
  TOOLTIP_TEXT:
    'When enabled, the Rose Protocol bot will automatically approve and merge this PR once both customer and stakeholder approve the completed task.',

  // Placeholder for PR URL input
  PLACEHOLDER: 'https://github.com/owner/repo/pull/123',

  // Backend API endpoint for PR validation
  VALIDATE_ENDPOINT: '/api/github/validate-pr',
};

/**
 * Validate a GitHub PR URL format (client-side).
 * @param {string} url - The URL to validate
 * @returns {string} - Error message if invalid, empty string if valid
 */
export const validatePrUrl = (url) => {
  if (!url || url.trim().length === 0) {
    return 'PR URL is required when GitHub integration is enabled';
  }

  const trimmed = url.trim();

  if (!GITHUB_INTEGRATION.PR_URL_REGEX.test(trimmed)) {
    return 'Invalid GitHub PR URL. Format: https://github.com/owner/repo/pull/123';
  }

  return '';
};

/**
 * Validate PR URL with the backend (checks if app has access and PR is open).
 * @param {string} url - The PR URL to validate
 * @param {string} signerUrl - The backend signer URL
 * @returns {Promise<{valid: boolean, error?: string, title?: string}>}
 */
export const validatePrUrlWithBackend = async (url, signerUrl) => {
  try {
    const response = await fetch(`${signerUrl}${GITHUB_INTEGRATION.VALIDATE_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prUrl: url }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to validate PR URL with backend:', error);
    return {
      valid: false,
      error: 'Failed to connect to validation service',
    };
  }
};
