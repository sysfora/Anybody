import domainsList from 'disposable-email-domains';
import wildcardDomainsList from 'disposable-email-domains/wildcard.json';

// Convert arrays to Sets for O(1) lookup performance
const domainsSet = new Set(domainsList as string[]);
const wildcardDomains = wildcardDomainsList as string[];

/**
 * Checks if an email address is from a temporary/disposable email domain
 * 
 * IMPORTANT: The disposable-email-domains package does NOT auto-update on deployment.
 * It uses a static list that only updates when you run `npm update disposable-email-domains`.
 * 
 * The package sources its list from:
 * - GitHub repository: https://github.com/ivolo/disposable-email-domains
 * - Updated regularly through community contributions
 * - Contains both exact domain matches and wildcard patterns
 * - Currently includes 121,570+ domains
 * 
 * To keep the list current, you can:
 * 1. Periodically run: npm update disposable-email-domains
 * 2. Set up automated dependency updates (Dependabot, Renovate)
 * 
 * @param email - The email address to check
 * @returns true if the email is from a temporary email domain, false otherwise
 */
export function isTemporaryEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Extract domain from email
  const emailParts = email.toLowerCase().trim().split('@');
  
  if (emailParts.length !== 2) {
    return false;
  }

  const domain = emailParts[1];

  // Check if domain is an exact match in the disposable email domains set
  if (domainsSet.has(domain)) {
    return true;
  }

  // Check if domain matches any wildcard pattern (e.g., *.33mail.com)
  // Wildcard domains are patterns like "33mail.com" that match any subdomain
  for (const wildcardDomain of wildcardDomains) {
    // Remove the leading * if present
    const pattern = wildcardDomain.startsWith('*.') 
      ? wildcardDomain.slice(2) 
      : wildcardDomain;
    
    // Check if the domain ends with the wildcard pattern
    if (domain.endsWith('.' + pattern) || domain === pattern) {
      return true;
    }
  }

  return false;
}

