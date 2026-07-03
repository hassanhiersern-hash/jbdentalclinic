import { Router } from 'express';
import {
  getPatients,
  getPatientById,
  searchPatients,
  createPatient,
  updatePatient,
  deletePatient,
  getDb,
} from '../db.js';
import { validatePatientBody } from '../middleware/validate-patient.js';
import { writeAuditLog } from '../lib/audit.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { q, limit, offset } = req.query;
    const list = q
      ? await searchPatients(q)
      : await getPatients({ limit: limit ? Math.min(Number(limit), 500) : 100, offset: offset ? Number(offset) : 0 });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const row = await getPatientById(id);
    if (!row) return res.status(404).json({ error: 'Patient not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', validatePatientBody, async (req, res) => {
  try {
    const id = await createPatient(req.validated);
    const row = await getPatientById(id);
    writeAuditLog(req, {
      action: 'CREATE',
      entity_type: 'patient',
      entity_id: id,
      new_values: row,
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', validatePatientBody, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const existing = await getPatientById(id);
    if (!existing) return res.status(404).json({ error: 'Patient not found' });
    await updatePatient(id, req.validated);
    const row = await getPatientById(id);
    writeAuditLog(req, {
      action: 'UPDATE',
      entity_type: 'patient',
      entity_id: id,
      old_values: existing,
      new_values: row,
    });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const existing = await getPatientById(id);
    if (!existing) return res.status(404).json({ error: 'Patient not found' });

    const db = getDb();
    const count = async (table, col) => {
      const res = await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, args: [id] });
      return Number(res.rows[0]?.n) || 0;
    };
    const refs = [];
    const appts = await count('appointments', 'patient_id');
    if (appts) refs.push(`${appts} appointment(s)`);
    const treats = await count('treatments', 'patient_id');
    if (treats) refs.push(`${treats} treatment(s)`);
    const invs = await count('invoices', 'patient_id');
    if (invs) refs.push(`${invs} invoice(s)`);
    const plans = await count('treatment_plans', 'patient_id');
    if (plans) refs.push(`${plans} treatment plan(s)`);
    const charts = await count('dental_chart', 'patient_id');
    if (charts) refs.push(`${charts} dental chart entry(ies)`);
    const reports = await count('patient_reports', 'patient_id');
    if (reports) refs.push(`${reports} patient report(s)`);

    if (refs.length) {
      return res.status(409).json({
        error: `Cannot delete patient. Related records exist: ${refs.join(', ')}. Remove related records first.`
      });
    }

    await deletePatient(id);
    writeAuditLog(req, {
      action: 'DELETE',
      entity_type: 'patient',
      entity_id: id,
      old_values: existing,
    });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
