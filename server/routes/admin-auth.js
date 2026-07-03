import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { getUserByEmail } from '../db.js';
import { JWT_SECRET, JWT_EXPIRY } from '../config/admin.js';
import { writeAuditLog } from '../lib/audit.js';

const router = Router();

/**
 * Admin login: email + bcrypt-hashed password from users table.
 * On success returns a signed JWT token for subsequent API calls.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await getUserByEmail(String(email).trim().toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(String(password), user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (String(user.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Admin access is required for this login.' });
    }

    const token = jwt.sign(
      { sub: user.email, role: user.role, userId: user.id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    writeAuditLog(req, {
      action: 'LOGIN',
      entity_type: 'user',
      entity_id: user.id,
      actor: { user_id: user.id, user_email: user.email },
      new_values: { role: user.role },
    });

    res.json({ success: true, token, expiresIn: JWT_EXPIRY });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
