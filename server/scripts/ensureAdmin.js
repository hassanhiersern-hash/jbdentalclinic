import bcrypt from 'bcrypt';
import { getDb, initDb } from '../db.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../config/admin.js';

export async function ensureAdmin() {
  const db = getDb();
  const email = ADMIN_EMAIL.trim().toLowerCase();

  const res = await db.execute({
    sql: 'SELECT id, email, password, role FROM users WHERE email = ?',
    args: [email]
  });
  const existing = res.rows[0];

  const desiredPassword = String(ADMIN_PASSWORD ?? '');
  const desiredRole = 'admin';

  if (existing) {
    let needsUpdate = false;

    if (existing.role !== desiredRole) {
      needsUpdate = true;
    }

    try {
      const matches = await bcrypt.compare(desiredPassword, existing.password);
      if (!matches) {
        needsUpdate = true;
      }
    } catch {
      needsUpdate = true;
    }

    if (!needsUpdate) {
      console.log('Admin already exists:', email);
      return;
    }

    const hash = await bcrypt.hash(desiredPassword, 10);
    await db.execute({
      sql: 'UPDATE users SET password = ?, role = ? WHERE id = ?',
      args: [hash, desiredRole, existing.id]
    });
    console.log('Admin account updated:', email);
    return;
  }

  const hash = await bcrypt.hash(desiredPassword, 10);
  await db.execute({
    sql: 'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
    args: [email, hash, desiredRole]
  });
  console.log('Admin account created:', email);
}

// Allow running standalone: node server/scripts/ensureAdmin.js
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  initDb()
    .then(() => ensureAdmin())
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
