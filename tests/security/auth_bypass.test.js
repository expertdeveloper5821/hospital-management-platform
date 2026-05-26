const { expect } = require('chai');
const { createDriver } = require('./driver-helper');
const config = require('./config');
const { By, until } = require('selenium-webdriver');

describe('Security: Authentication Bypass', function () {
  let driver;
  this.timeout(30000);

  before(async function () {
    driver = await createDriver();
  });

  after(async function () {
    if (driver) {
      await driver.quit();
    }
  });

  const protectedRoutes = [
    '/dashboard',
    '/patients',
    '/opd',
    '/ipd',
    '/inventory',
    '/payments',
    '/super-admin'
  ];

  protectedRoutes.forEach(route => {
    it(`should redirect unauthenticated user from ${route} to login`, async function () {
      await driver.get(`${config.baseUrl}${route}`);
      
      // Wait for redirect to login page
      await driver.wait(until.urlContains('/login'), config.timeout);
      const currentUrl = await driver.getCurrentUrl();
      
      expect(currentUrl).to.include('/login');
    });
  });
});
