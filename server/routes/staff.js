import { Router } from 'express';
import {
  getStaff,
  getStaffMemberById,
  createStaff,
  updateStaff,
  deleteStaff,
  getDb,
} from '../db.js';
import { validateStaffBody } from '../middleware/validate-staff.js';
import { writeAuditLog } from '../lib/audit.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { role, is_active, limit, offset } = req.query;
    const isActive = is_active === undefined ? undefined : is_active === 'true' || is_active === '1';
    const list = await getStaff({
      role: role || undefined,
      is_active: isActive,
      limit: limit ? Math.min(Number(limit), 500) : 100,
      offset: offset ? Number(offset) : 0,
    });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const row = await getStaffMemberById(id);
    if (!row) return res.status(404).json({ error: 'Staff member not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', validateStaffBody, async (req, res) => {
  try {
    const id = await createStaff(req.validated);
    const row = await getStaffMemberById(id);
    writeAuditLog(req, { action: 'CREATE', entity_type: 'staff', entity_id: id, new_values: row });
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', validateStaffBody, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const existing = await getStaffMemberById(id);
    if (!existing) return res.status(404).json({ error: 'Staff member not found' });
    await updateStaff(id, req.validated);
    const row = await getStaffMemberById(id);
    writeAuditLog(req, { action: 'UPDATE', entity_type: 'staff', entity_id: id, old_values: existing, new_values: row });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    const existing = await getStaffMemberById(id);
    if (!existing) return res.status(404).json({ error: 'Staff member not found' });

    const db = getDb();
    const count = async (table, col) => {
      const r = await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, args: [id] });
      return Number(r.rows[0]?.n) || 0;
    };
    const refs = [];
    const appts = await count('appointments', 'dentist_id');
    if (appts) refs.push(`${appts} appointment(s)`);
    const treats = await count('treatments', 'dentist_id');
    if (treats) refs.push(`${treats} treatment(s)`);
    const reports = await count('patient_reports', 'doctor_id');
    if (reports) refs.push(`${reports} patient report(s)`);

    if (refs.length) {
      return res.status(409).json({
        error: `Cannot delete staff member. Related records exist: ${refs.join(', ')}. Remove related records first.`
      });
    }

    await deleteStaff(id);
    writeAuditLog(req, { action: 'DELETE', entity_type: 'staff', entity_id: id, old_values: existing });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
