# Selenium Penetration Testing Suite

This directory contains automated security tests (Penetration Tests) for the Hospital Management Platform using Selenium WebDriver.

## Prerequisites

1.  **Node.js**: Ensure Node.js is installed.
2.  **Chrome Browser**: The tests are configured to use Google Chrome.
3.  **ChromeDriver**: Must be installed and available in your PATH, or managed via `webdriver-manager`.
4.  **Application Running**: Both the frontend (port 3000) and backend (port 5000) must be running.
5.  **Seeded Data**: The tests assume specific users exist (see `config.js`). Run `npm run seed:all` in the `server` directory before testing.

## Installation

```bash
cd tests/security
npm install
```

## Running Tests

To run all security tests:
```bash
npm test
```

To run specific tests:
```bash
npm run test:auth       # Authentication bypass checks
npm run test:rbac       # RBAC enforcement checks
npm run test:xss        # XSS injection checks
npm run test:isolation  # Multi-tenant isolation checks
```

## Security Coverage

| Test Case | Vulnerability Type | Description |
|---|---|---|
| `auth_bypass.test.js` | Broken Authentication | Verifies that protected routes redirect to login. |
| `rbac_violation.test.js` | Broken Access Control | Verifies that users cannot access modules outside their role permissions. |
| `xss_injection.test.js` | Cross-Site Scripting | Verifies that the application escapes HTML/JS in input fields. |
| `tenant_isolation.test.js` | IDOR / Multi-tenancy | Verifies that users cannot access data belonging to other tenants. |

## Configuration

Modify `config.js` to change the base URL, API URL, or test credentials.
By default, tests run in **headless mode**. Set `HEADLESS=false` to see the browser:
```bash
$env:HEADLESS="false"; npm test
```
