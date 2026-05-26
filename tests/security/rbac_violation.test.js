const { expect } = require('chai');
const { createDriver } = require('./driver-helper');
const config = require('./config');
const { By, until } = require('selenium-webdriver');

describe('Security: RBAC Enforcement', function () {
  let driver;
  this.timeout(60000);

  before(async function () {
    driver = await createDriver();
  });

  after(async function () {
    if (driver) {
      await driver.quit();
    }
  });

  async function login(email, password) {
    await driver.get(`${config.baseUrl}/login`);
    await driver.wait(until.elementLocated(By.name('email')), config.timeout);
    await driver.findElement(By.name('email')).sendKeys(email);
    await driver.findElement(By.name('password')).sendKeys(password);
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    // Wait for dashboard or main page
    await driver.wait(until.urlContains('/dashboard'), config.timeout);
  }

  it('Receptionist should NOT be able to access Inventory module', async function () {
    await login(config.credentials.receptionist.email, config.credentials.receptionist.password);
    
    // Attempt to navigate to inventory
    await driver.get(`${config.baseUrl}/inventory`);
    
    // The system should either show 403, redirect to unauthorized page, or redirect back to dashboard
    // Based on requirements FR-13, it should return 403 at API level, but frontend might handle it by redirecting
    // We'll check if the URL stays /inventory or redirects, and if an error message is shown
    
    const currentUrl = await driver.getCurrentUrl();
    // In many Next.js apps, if middleware handles it, it might redirect to /dashboard or /403
    expect(currentUrl).to.not.equal(`${config.baseUrl}/inventory`);
  });

  it('Doctor should NOT be able to access Payments module', async function () {
    // Note: Re-logging in or clearing session might be needed
    await driver.executeScript('window.localStorage.clear();');
    await driver.executeScript('window.sessionStorage.clear();');
    
    await login(config.credentials.doctor.email, config.credentials.doctor.password);
    
    await driver.get(`${config.baseUrl}/payments`);
    const currentUrl = await driver.getCurrentUrl();
    expect(currentUrl).to.not.equal(`${config.baseUrl}/payments`);
  });
});
