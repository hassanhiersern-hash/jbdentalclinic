import { Router } from 'express';
import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getTotalPaidForInvoice,
  getDb,
} from '../db.js';
import { validateInvoiceBody } from '../middleware/validate-invoice.js';
import { writeAuditLog } from '../lib/audit.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { patient_id, status, limit, offset } = req.query;
    const list = await getInvoices({
      patient_id: patient_id != null ? Number(patient_id) : undefined,
      status: status || undefined,
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
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const row = await getInvoiceById(id);
    if (!row) return res.status(404).json({ error: 'Invoice not found' });
    const paid = await getTotalPaidForInvoice(id);
    res.json({ ...row, total_paid: paid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', validateInvoiceBody, async (req, res) => {
  try {
    const id = await createInvoice(req.validated);
    const row = await getInvoiceById(id);
    await writeAuditLog(req, {
      action: 'CREATE',
      entity_type: 'invoice',
      entity_id: id,
      new_values: row,
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', validateInvoiceBody, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const existing = await getInvoiceById(id);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    await updateInvoice(id, req.validated);
    const row = await getInvoiceById(id);
    await writeAuditLog(req, {
      action: 'UPDATE',
      entity_type: 'invoice',
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
    const existing = await getInvoiceById(id);
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    // Check for related payments before deletion
    const db = getDb();
    const paymentCountRow = (await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?',
      args: [id],
    })).rows[0];
    const paymentCount = paymentCountRow?.n || 0;
    if (paymentCount > 0) {
      return res.status(409).json({
        error: `Cannot delete invoice. ${paymentCount} payment(s) are linked to this invoice. Remove payments first.`
      });
    }

    await deleteInvoice(id);
    await writeAuditLog(req, {
      action: 'DELETE',
      entity_type: 'invoice',
      entity_id: id,
      old_values: existing,
    });
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
