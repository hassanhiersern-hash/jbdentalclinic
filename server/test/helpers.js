import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import jwt from 'jsonwebtoken';
import { closeDb, getAuditLogs, getDb } from '../db.js';
import { createUser, getUserByEmail } from '../db.js';
import { createApp } from '../app.js';
import { JWT_SECRET } from '../config/admin.js';

export async function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jb-dental-test-'));
  const dbPath = path.join(tempDir, 'test.db');

  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-with-sufficient-length-12345';
  process.env.ADMIN_EMAIL = 'admin@test.local';
  process.env.ADMIN_PASSWORD = 'Admin12345!';
  process.env.TURSO_DATABASE_URL = 'file:' + dbPath;

  closeDb();
  const app = createApp();

  return {
    app,
    dbPath,
    tempDir,
    async createUserAccount({ email, password, role }) {
      const existing = getUserByEmail(email);
      if (existing) {
        return existing;
      }

      const id = await createUser({ email, password, role });
      const res = await getDb().execute({ sql: 'SELECT id, email, role FROM users WHERE id = ?', args: [id] });
      return res.rows[0];
    },
    signToken(payload, secret = JWT_SECRET) {
      return jwt.sign(payload, secret, { expiresIn: '1h' });
    },
    getAuditLogs,
    cleanup() {
      closeDb();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
