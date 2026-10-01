import type { Page } from '@playwright/test';

/* Helpers for the admin specs: the admin CSP (spec §11) must never block the app's own code. */

/** Collects CSP violations two ways: the DOM event (installed before any page script) and Chrome's console report. */
export async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(`console: ${m.text()}`);
  });
  await page.exposeFunction('reportCspViolation', (v: string) => violations.push(`event: ${v}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { reportCspViolation: (v: string) => void }).reportCspViolation(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
      );
    });
  });
  return violations;
}

/** React attached to the document, i.e. the nonced bootstrap scripts ran and hydrated it. */
export async function expectHydrated(page: Page) {
  await page.waitForFunction(() => Object.keys(document).some((k) => k.startsWith('__reactContainer$')));
}
