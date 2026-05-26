module.exports = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:5000',
  timeout: 10000,
  // Sample credentials (these should be seeded in the dev environment)
  credentials: {
    superAdmin: {
      email: 'superadmin@hms.com',
      password: 'Password123!'
    },
    hospitalAdmin: {
      email: 'admin@apollo.com',
      password: 'Password123!'
    },
    doctor: {
      email: 'doctor@apollo.com',
      password: 'Password123!'
    },
    receptionist: {
      email: 'receptionist@apollo.com',
      password: 'Password123!'
    }
  }
};
