import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const searchTerm = `%${q.trim()}%`;
    const maxResults = Math.min(Number(limit) || 20, 50);
    const db = getDb();

    const [patientsRes, appointmentsRes, staffRes, invoicesRes, treatmentsRes] = await Promise.all([
      db.execute({
        sql: `SELECT id, full_name as name, phone, email, 'patient' as type
              FROM patients WHERE full_name LIKE ? OR phone LIKE ? OR email LIKE ? LIMIT ?`,
        args: [searchTerm, searchTerm, searchTerm, maxResults]
      }),
      db.execute({
        sql: `SELECT a.id, a.patient_name as name, a.patient_phone as phone,
                a.appointment_date as date, a.appointment_time as time, a.status, 'appointment' as type
              FROM appointments a
              WHERE a.patient_name LIKE ? OR a.patient_phone LIKE ? OR a.service LIKE ?
              ORDER BY a.appointment_date DESC LIMIT ?`,
        args: [searchTerm, searchTerm, searchTerm, maxResults]
      }),
      db.execute({
        sql: `SELECT id, full_name as name, phone, email, role, 'staff' as type
              FROM staff WHERE full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR role LIKE ? LIMIT ?`,
        args: [searchTerm, searchTerm, searchTerm, searchTerm, maxResults]
      }),
      db.execute({
        sql: `SELECT i.id, p.full_name as name, i.total_amount, i.status, i.created_at as date, 'invoice' as type
              FROM invoices i JOIN patients p ON i.patient_id = p.id
              WHERE p.full_name LIKE ? ORDER BY i.created_at DESC LIMIT ?`,
        args: [searchTerm, maxResults]
      }),
      db.execute({
        sql: `SELECT t.id, p.full_name as name, t.service_name as service, t.treatment_date as date, t.status, 'treatment' as type
              FROM treatments t JOIN patients p ON t.patient_id = p.id
              WHERE p.full_name LIKE ? OR t.service_name LIKE ?
              ORDER BY t.treatment_date DESC LIMIT ?`,
        args: [searchTerm, searchTerm, maxResults]
      }),
    ]);

    const results = {
      patients: patientsRes.rows,
      appointments: appointmentsRes.rows,
      staff: staffRes.rows,
      invoices: invoicesRes.rows,
      treatments: treatmentsRes.rows,
      total: 0,
    };
    results.total = results.patients.length + results.appointments.length +
                    results.staff.length + results.invoices.length + results.treatments.length;

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
