import { z } from 'zod';

// Mock database structures for SQL demonstration
interface SQLUser {
  id: number;
  email: string;
  role: string;
}

const mockSqlDb: SQLUser[] = [
  { id: 1, email: 'admin@hospital.com', role: 'admin' },
  { id: 2, email: 'doctor@hospital.com', role: 'doctor' },
];

/**
 * Simulates a vulnerable query builder that concatenates raw strings.
 */
function vulnerableSqlFetchUser(email: string): string {
  return `SELECT * FROM users WHERE email = '${email}'`;
}

/**
 * Simulates a secure query builder using parameterized bindings.
 */
function secureSqlFetchUser(email: string): { sql: string; params: string[] } {
  return {
    sql: 'SELECT * FROM users WHERE email = ?',
    params: [email],
  };
}

/**
 * Zod validation schema representing a typical request payload validation
 * in our Express endpoints (similar to auth/patient modules).
 */
const loginValidationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

describe('SQL Injection - Testing & Prevention', () => {
  describe('Vulnerable Query Builder (Concatenation)', () => {
    test('constructs query normally for safe input', () => {
      const email = 'doctor@hospital.com';
      const sql = vulnerableSqlFetchUser(email);
      expect(sql).toBe("SELECT * FROM users WHERE email = 'doctor@hospital.com'");
    });

    test('vulnerable to SQL logic bypass via quotes and tautology', () => {
      // Payload attempts to bypass the search filter by injecting OR '1'='1
      const maliciousEmail = "attacker@hospital.com' OR '1'='1";
      const sql = vulnerableSqlFetchUser(maliciousEmail);

      // The structure of the query is altered:
      expect(sql).toBe("SELECT * FROM users WHERE email = 'attacker@hospital.com' OR '1'='1'");
    });
  });

  describe('Secure Query Builder (Prepared Statements)', () => {
    test('mitigates SQL injection by keeping parameters separate from the SQL structure', () => {
      const maliciousEmail = "attacker@hospital.com' OR '1'='1";
      const result = secureSqlFetchUser(maliciousEmail);

      // The query structure remains constant and safe:
      expect(result.sql).toBe('SELECT * FROM users WHERE email = ?');
      // The payload is strictly treated as a literal value:
      expect(result.params[0]).toBe("attacker@hospital.com' OR '1'='1");
    });
  });
});

describe('NoSQL Injection - Testing & Prevention', () => {
  describe('Input Validation via Zod Schemas', () => {
    test('successfully validates safe string inputs', () => {
      const safeInput = {
        email: 'doctor@hospital.com',
        password: 'SecurePassword123!',
      };

      const result = loginValidationSchema.safeParse(safeInput);
      expect(result.success).toBe(true);
    });

    test('prevents MongoDB operator injection by strictly checking types', () => {
      // In NoSQL Injection, the attacker passes an object (e.g. { $ne: ... })
      // instead of a string to manipulate the MongoDB query comparison operator.
      const maliciousInput = {
        email: { $ne: 'nonexistent@hospital.com' },
        password: { $gt: '' },
      };

      const result = loginValidationSchema.safeParse(maliciousInput);

      // Zod validation should fail the request because a string is expected, not an object
      expect(result.success).toBe(false);

      if (!result.success) {
        const errors = result.error.flatten().fieldErrors;
        expect(errors.email).toBeDefined();
        expect(errors.email?.[0]).toContain('Expected string, received object');
        expect(errors.password).toBeDefined();
        expect(errors.password?.[0]).toContain('Expected string, received object');
      }
    });
  });
});
