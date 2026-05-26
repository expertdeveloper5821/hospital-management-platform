const { expect } = require('chai');
const { createDriver } = require('./driver-helper');
const config = require('./config');
const { By, until } = require('selenium-webdriver');

describe('Security: Multi-Tenant Isolation', function () {
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
    await driver.wait(until.urlContains('/dashboard'), config.timeout);
  }

  it('User from Tenant A should NOT be able to access data from Tenant B', async function () {
    // Log in as Tenant A user
    await login(config.credentials.hospitalAdmin.email, config.credentials.hospitalAdmin.password);
    
    // Assume we found a patient ID from another tenant (Tenant B)
    const otherTenantPatientId = 'tenant-b-patient-123';
    
    // Try to access the details page for that patient
    await driver.get(`${config.baseUrl}/patients/${otherTenantPatientId}`);
    
    // Check for 403 error message or redirect
    // Requirement FR-02.3: System SHALL return HTTP 403
    // The frontend should show an error or redirect
    const currentUrl = await driver.getCurrentUrl();
    expect(currentUrl).to.not.include(`/patients/${otherTenantPatientId}`);
    
    // Check for "Access Denied" or similar text on page
    const bodyText = await driver.findElement(By.tagName('body')).getText();
    const isErrorShown = bodyText.toLowerCase().includes('forbidden') || 
                        bodyText.toLowerCase().includes('denied') || 
                        bodyText.toLowerCase().includes('not found');
                        
    expect(isErrorShown).to.be.true;
  });
});
