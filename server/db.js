import { createClient } from '@libsql/client';
import cron from 'node-cron';
import bcrypt from 'bcrypt';
import { runExtensionMigrations } from './migrate-extensions.js';
import { normalizeE164 } from './lib/whatsapp.js';

let db;

export function getDb() {
  if (!db) {
    const url = process.env.TURSO_DATABASE_URL || 'file:./data/appointments.db';
    const authToken = process.env.TURSO_AUTH_TOKEN;
    db = createClient({ url, authToken });
    console.log(`[db] Connected to libSQL: ${url}`);
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

async function migrate(database) {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_id INTEGER,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 30,
      service TEXT,
      notes TEXT,
      status TEXT DEFAULT 'Scheduled',
      reminder_sent_at TEXT,
      thank_you_sent_at TEXT,
      reminder_1day_sent_at TEXT,
      reminder_6h_sent_at TEXT,
      reminder_1h_sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_appointments_reminder ON appointments(appointment_date, reminder_sent_at)`);
  await runExtensionMigrations(database);
}

export async function initDb() {
  const database = getDb();

  await database.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS communication_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER,
      patient_id INTEGER,
      patient_name TEXT,
      patient_phone TEXT,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      error TEXT,
      sent_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_comm_logs_appointment ON communication_logs(appointment_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_comm_logs_sent_at ON communication_logs(sent_at)`);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_values TEXT,
      new_values TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)`);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      date_of_birth TEXT,
      gender TEXT,
      medical_history TEXT,
      allergies TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name)`);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_id INTEGER,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 30,
      service TEXT,
      notes TEXT,
      status TEXT DEFAULT 'Scheduled',
      reminder_sent_at TEXT,
      thank_you_sent_at TEXT,
      reminder_1day_sent_at TEXT,
      reminder_6h_sent_at TEXT,
      reminder_1h_sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_appointments_reminder ON appointments(appointment_date, reminder_sent_at)`);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      paid_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)`);
  await database.execute(`
    CREATE TABLE IF NOT EXISTS treatments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      dentist_id INTEGER,
      treatment_plan_id INTEGER,
      service_name TEXT NOT NULL,
      description TEXT,
      cost REAL,
      treatment_date TEXT,
      status TEXT DEFAULT 'Pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_treatments_patient ON treatments(patient_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_treatments_plan ON treatments(treatment_plan_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_treatments_date ON treatments(treatment_date)`);

  await runExtensionMigrations(database);
  scheduleBackup();
  return database;
}

// ---------- Automatic Backup ----------
function scheduleBackup() {
  const schedule = process.env.BACKUP_CRON || '0 2 * * *';
  cron.schedule(schedule, () => {
    console.log('[backup] Remote Turso DB — no local file backup needed.');
  }, { scheduled: true, timezone: process.env.TZ || 'Africa/Kampala' });
}

// ---------- Appointments ----------
export async function getAppointments(filters = {}) {
  const database = getDb();
  const { date, fromDate, toDate, limit = 100, offset = 0 } = filters;
  let sql = 'SELECT * FROM appointments WHERE 1=1';
  const args = [];

  if (date) { sql += ' AND appointment_date = ?'; args.push(date); }
  if (fromDate) { sql += ' AND appointment_date >= ?'; args.push(fromDate); }
  if (toDate) { sql += ' AND appointment_date <= ?'; args.push(toDate); }
  sql += ' ORDER BY appointment_date ASC, appointment_time ASC LIMIT ? OFFSET ?';
  args.push(limit, offset);

  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getAppointmentsForReminder(targetDate = null) {
  const database = getDb();
  const date = targetDate || (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const result = await database.execute({
    sql: 'SELECT * FROM appointments WHERE appointment_date = ? AND reminder_sent_at IS NULL ORDER BY appointment_time ASC',
    args: [date]
  });
  return result.rows;
}

export async function getAppointmentById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM appointments WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function createAppointment(data) {
  const database = getDb();
  const statusVal = data.status && ['Scheduled', 'Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'].includes(data.status)
    ? data.status : 'Scheduled';
  const result = await database.execute({
    sql: `INSERT INTO appointments (patient_name, patient_phone, appointment_date, appointment_time, service, notes, patient_id, dentist_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.patient_name, data.patient_phone, data.appointment_date, data.appointment_time,
      data.service || null, data.notes || null, data.patient_id ?? null, data.dentist_id ?? null, statusVal
    ]
  });
  return Number(result.lastInsertRowid);
}

export async function updateAppointment(id, data) {
  const database = getDb();
  const statusVal = data.status && ['Scheduled', 'Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'].includes(data.status)
    ? data.status : null;
  const result = await database.execute({
    sql: `UPDATE appointments SET
      patient_name = ?, patient_phone = ?, appointment_date = ?, appointment_time = ?,
      service = ?, notes = ?,
      patient_id = COALESCE(?, patient_id),
      dentist_id = COALESCE(?, dentist_id),
      status = COALESCE(?, status),
      updated_at = datetime('now')
    WHERE id = ?`,
    args: [
      data.patient_name, data.patient_phone, data.appointment_date, data.appointment_time,
      data.service ?? null, data.notes ?? null, data.patient_id ?? null, data.dentist_id ?? null,
      statusVal, id
    ]
  });
  return result.rowsAffected;
}

export async function markReminderSent(id) {
  return await getDb().execute({
    sql: `UPDATE appointments SET reminder_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    args: [id]
  });
}

export async function deleteAppointment(id) {
  return await getDb().execute({ sql: 'DELETE FROM appointments WHERE id = ?', args: [id] });
}

// ---------- Patients ----------
export async function getPatients(filters = {}) {
  const database = getDb();
  const lim = Math.min(Number(filters.limit) || 100, 500);
  const off = Number(filters.offset) || 0;
  const result = await database.execute({
    sql: 'SELECT * FROM patients ORDER BY full_name ASC LIMIT ? OFFSET ?',
    args: [lim, off]
  });
  return result.rows;
}

export async function getPatientById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM patients WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function getPatientByPhone(phone) {
  const database = getDb();
  const normalized = normalizeE164(phone);
  const candidates = [phone];
  if (normalized) {
    candidates.push(normalized);
    candidates.push('0' + normalized.slice(3));
  }
  const placeholders = candidates.map(() => '?').join(' OR phone = ');
  const result = await database.execute({
    sql: `SELECT * FROM patients WHERE phone = ${placeholders} LIMIT 1`,
    args: candidates
  });
  return result.rows[0];
}

export async function searchPatients(q) {
  const database = getDb();
  const term = `%${String(q || '').trim()}%`;
  const result = await database.execute({
    sql: `SELECT * FROM patients WHERE full_name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY full_name ASC LIMIT 100`,
    args: [term, term, term]
  });
  return result.rows;
}

export async function createPatient(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO patients (full_name, phone, email, date_of_birth, gender, medical_history, allergies)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [data.full_name, data.phone, data.email || null, data.date_of_birth || null,
           data.gender || null, data.medical_history || null, data.allergies || null]
  });
  return Number(result.lastInsertRowid);
}

export async function updatePatient(id, data) {
  const database = getDb();
  return await database.execute({
    sql: `UPDATE patients SET full_name = ?, phone = ?, email = ?, date_of_birth = ?, gender = ?,
          medical_history = ?, allergies = ? WHERE id = ?`,
    args: [data.full_name, data.phone, data.email ?? null, data.date_of_birth ?? null,
           data.gender ?? null, data.medical_history ?? null, data.allergies ?? null, id]
  });
}

export async function deletePatient(id) {
  return await getDb().execute({ sql: 'DELETE FROM patients WHERE id = ?', args: [id] });
}

// ---------- Patient Reports ----------
export async function getPatientReports(filters = {}) {
  const database = getDb();
  const { patient_id, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM patient_reports WHERE 1=1';
  const args = [];
  if (patient_id != null) { sql += ' AND patient_id = ?'; args.push(patient_id); }
  sql += ' ORDER BY report_date DESC, id DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getPatientReportById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM patient_reports WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function createPatientReport(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO patient_reports (patient_id, doctor_id, report_date, chief_complaint, clinical_findings, diagnosis, treatment_plan, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.patient_id, data.doctor_id ?? null, data.report_date || null,
           data.chief_complaint || null, data.clinical_findings || null,
           data.diagnosis || null, data.treatment_plan || null, data.notes || null]
  });
  return Number(result.lastInsertRowid);
}

export async function updatePatientReport(id, data) {
  const database = getDb();
  return await database.execute({
    sql: `UPDATE patient_reports SET patient_id = ?, doctor_id = ?, report_date = ?,
          chief_complaint = ?, clinical_findings = ?, diagnosis = ?, treatment_plan = ?, notes = ?,
          updated_at = datetime('now') WHERE id = ?`,
    args: [data.patient_id, data.doctor_id ?? null, data.report_date || null,
           data.chief_complaint ?? null, data.clinical_findings ?? null,
           data.diagnosis ?? null, data.treatment_plan ?? null, data.notes ?? null, id]
  });
}

export async function deletePatientReport(id) {
  return await getDb().execute({ sql: 'DELETE FROM patient_reports WHERE id = ?', args: [id] });
}

// ---------- Staff ----------
export async function getStaff(filters = {}) {
  const database = getDb();
  const { role, is_active, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM staff WHERE 1=1';
  const args = [];
  if (role) { sql += ' AND role = ?'; args.push(role); }
  if (typeof is_active === 'boolean' || typeof is_active === 'number') {
    sql += ' AND is_active = ?'; args.push(is_active ? 1 : 0);
  }
  sql += ' ORDER BY full_name ASC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getStaffMemberById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM staff WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function getStaffByRole(role) {
  return getStaff({ role, limit: 500 });
}

export async function createStaff(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO staff (full_name, role, phone, email, salary, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [data.full_name, data.role, data.phone || null, data.email || null,
           data.salary ?? null, data.is_active !== false ? 1 : 0]
  });
  return Number(result.lastInsertRowid);
}

export async function updateStaff(id, data) {
  const database = getDb();
  return await database.execute({
    sql: `UPDATE staff SET full_name = ?, role = ?, phone = ?, email = ?, salary = ?, is_active = ?,
          updated_at = datetime('now') WHERE id = ?`,
    args: [data.full_name, data.role, data.phone ?? null, data.email ?? null,
           data.salary ?? null, data.is_active !== false ? 1 : 0, id]
  });
}

export async function deleteStaff(id) {
  return await getDb().execute({ sql: 'DELETE FROM staff WHERE id = ?', args: [id] });
}

// ---------- Treatment Plans ----------
export async function getTreatmentPlans(filters = {}) {
  const database = getDb();
  const { patient_id, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM treatment_plans WHERE 1=1';
  const args = [];
  if (patient_id != null) { sql += ' AND patient_id = ?'; args.push(patient_id); }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getTreatmentPlanById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM treatment_plans WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function createTreatmentPlan(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO treatment_plans (patient_id, total_estimated_cost, status) VALUES (?, ?, ?)`,
    args: [data.patient_id, data.total_estimated_cost ?? null, data.status || 'Active']
  });
  return Number(result.lastInsertRowid);
}

export async function updateTreatmentPlan(id, data) {
  const database = getDb();
  return await database.execute({
    sql: `UPDATE treatment_plans SET patient_id = ?, total_estimated_cost = ?, status = ?,
          updated_at = datetime('now') WHERE id = ?`,
    args: [data.patient_id, data.total_estimated_cost ?? null, data.status ?? 'Active', id]
  });
}

export async function deleteTreatmentPlan(id) {
  return await getDb().execute({ sql: 'DELETE FROM treatment_plans WHERE id = ?', args: [id] });
}

// ---------- Treatments ----------
export async function getTreatments(filters = {}) {
  const database = getDb();
  const { patient_id, dentist_id, treatment_plan_id, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM treatments WHERE 1=1';
  const args = [];
  if (patient_id != null) { sql += ' AND patient_id = ?'; args.push(patient_id); }
  if (dentist_id != null) { sql += ' AND dentist_id = ?'; args.push(dentist_id); }
  if (treatment_plan_id != null) { sql += ' AND treatment_plan_id = ?'; args.push(treatment_plan_id); }
  sql += ' ORDER BY treatment_date DESC, id DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getTreatmentById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM treatments WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function createTreatment(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO treatments (patient_id, dentist_id, treatment_plan_id, service_name, description, cost, treatment_date, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.patient_id, data.dentist_id ?? null, data.treatment_plan_id ?? null,
           data.service_name, data.description ?? null, data.cost ?? null,
           data.treatment_date ?? null, data.status || 'Pending']
  });
  return Number(result.lastInsertRowid);
}

export async function updateTreatment(id, data) {
  const database = getDb();
  return await database.execute({
    sql: `UPDATE treatments SET patient_id = ?, dentist_id = ?, treatment_plan_id = ?, service_name = ?,
          description = ?, cost = ?, treatment_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [data.patient_id, data.dentist_id ?? null, data.treatment_plan_id ?? null,
           data.service_name, data.description ?? null, data.cost ?? null,
           data.treatment_date ?? null, data.status ?? 'Pending', id]
  });
}

export async function deleteTreatment(id) {
  return await getDb().execute({ sql: 'DELETE FROM treatments WHERE id = ?', args: [id] });
}

// ---------- Dental Chart ----------
export async function getDentalChartEntries(filters = {}) {
  const database = getDb();
  const { patient_id, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 200, 500);
  let sql = 'SELECT * FROM dental_chart WHERE 1=1';
  const args = [];
  if (patient_id != null) { sql += ' AND patient_id = ?'; args.push(patient_id); }
  sql += ' ORDER BY tooth_number ASC, id ASC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getDentalChartEntryById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM dental_chart WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function createDentalChartEntry(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO dental_chart (patient_id, tooth_number, condition, notes) VALUES (?, ?, ?, ?)`,
    args: [data.patient_id, data.tooth_number, data.condition ?? null, data.notes ?? null]
  });
  return Number(result.lastInsertRowid);
}

export async function updateDentalChartEntry(id, data) {
  const database = getDb();
  return await database.execute({
    sql: `UPDATE dental_chart SET patient_id = ?, tooth_number = ?, condition = ?, notes = ?,
          updated_at = datetime('now') WHERE id = ?`,
    args: [data.patient_id, data.tooth_number, data.condition ?? null, data.notes ?? null, id]
  });
}

export async function deleteDentalChartEntry(id) {
  return await getDb().execute({ sql: 'DELETE FROM dental_chart WHERE id = ?', args: [id] });
}

// ---------- Invoices ----------
export async function getInvoices(filters = {}) {
  const database = getDb();
  const { patient_id, status, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM invoices WHERE 1=1';
  const args = [];
  if (patient_id != null) { sql += ' AND patient_id = ?'; args.push(patient_id); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getInvoiceById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function createInvoice(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO invoices (patient_id, total_amount, discount, tax, status) VALUES (?, ?, ?, ?, ?)`,
    args: [data.patient_id, data.total_amount ?? 0, data.discount ?? 0, data.tax ?? 0, data.status || 'Pending']
  });
  return Number(result.lastInsertRowid);
}

export async function updateInvoice(id, data) {
  const database = getDb();
  return await database.execute({
    sql: `UPDATE invoices SET patient_id = ?, total_amount = ?, discount = ?, tax = ?, status = ?,
          updated_at = datetime('now') WHERE id = ?`,
    args: [data.patient_id, data.total_amount ?? 0, data.discount ?? 0, data.tax ?? 0, data.status ?? 'Pending', id]
  });
}

export async function deleteInvoice(id) {
  return await getDb().execute({ sql: 'DELETE FROM invoices WHERE id = ?', args: [id] });
}

// ---------- Payments ----------
const PAYMENT_METHODS = ['Cash', 'Mobile Money', 'Bank'];

export async function getPayments(filters = {}) {
  const database = getDb();
  const { invoice_id, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM payments WHERE 1=1';
  const args = [];
  if (invoice_id != null) { sql += ' AND invoice_id = ?'; args.push(invoice_id); }
  sql += ' ORDER BY paid_at DESC, id DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getPaymentById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM payments WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function createPayment(data) {
  const database = getDb();
  const method = PAYMENT_METHODS.includes(data.payment_method) ? data.payment_method : 'Cash';
  const result = await database.execute({
    sql: `INSERT INTO payments (invoice_id, amount, payment_method, paid_at) VALUES (?, ?, ?, COALESCE(?, datetime('now')))`,
    args: [data.invoice_id, data.amount, method, data.paid_at ?? null]
  });
  return Number(result.lastInsertRowid);
}

export async function updatePayment(id, data) {
  const database = getDb();
  const method = data.payment_method && PAYMENT_METHODS.includes(data.payment_method) ? data.payment_method : null;
  return await database.execute({
    sql: `UPDATE payments SET invoice_id = ?, amount = ?,
          payment_method = COALESCE(?, payment_method),
          paid_at = COALESCE(?, paid_at) WHERE id = ?`,
    args: [data.invoice_id, data.amount, method, data.paid_at ?? null, id]
  });
}

export async function deletePayment(id) {
  return await getDb().execute({ sql: 'DELETE FROM payments WHERE id = ?', args: [id] });
}

export async function getTotalPaidForInvoice(invoiceId) {
  const result = await getDb().execute({
    sql: 'SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE invoice_id = ?',
    args: [invoiceId]
  });
  return result.rows[0] ? Number(result.rows[0].total) : 0;
}

// ---------- Inventory ----------
export async function getInventoryItems(filters = {}) {
  const database = getDb();
  const { low_stock_only, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM inventory_items WHERE 1=1';
  const args = [];
  if (low_stock_only) { sql += ' AND quantity <= minimum_stock AND minimum_stock > 0'; }
  sql += ' ORDER BY name ASC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getInventoryItemById(id) {
  const result = await getDb().execute({ sql: 'SELECT * FROM inventory_items WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function createInventoryItem(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO inventory_items (name, quantity, minimum_stock, supplier) VALUES (?, ?, ?, ?)`,
    args: [data.name, data.quantity ?? 0, data.minimum_stock ?? 0, data.supplier ?? null]
  });
  return Number(result.lastInsertRowid);
}

export async function updateInventoryItem(id, data) {
  const database = getDb();
  return await database.execute({
    sql: `UPDATE inventory_items SET name = ?, quantity = ?, minimum_stock = ?, supplier = ?,
          last_updated = datetime('now') WHERE id = ?`,
    args: [data.name, data.quantity ?? 0, data.minimum_stock ?? 0, data.supplier ?? null, id]
  });
}

export async function deleteInventoryItem(id) {
  return await getDb().execute({ sql: 'DELETE FROM inventory_items WHERE id = ?', args: [id] });
}

export async function getLowStockItems() {
  return getInventoryItems({ limit: 500, low_stock_only: true });
}

// ---------- Reports ----------
export async function getDailyRevenue(date) {
  const result = await getDb().execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date(paid_at) = ?`,
    args: [date]
  });
  return result.rows[0] ? Number(result.rows[0].total) : 0;
}

export async function getMonthlyRevenue(yearMonth) {
  const result = await getDb().execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE strftime('%Y-%m', paid_at) = ?`,
    args: [yearMonth]
  });
  return result.rows[0] ? Number(result.rows[0].total) : 0;
}

export async function getOutstandingBalances() {
  const database = getDb();
  const result = await database.execute({
    sql: `SELECT id, patient_id, total_amount, discount, tax, status FROM invoices WHERE status IN ('Pending', 'Partially Paid') ORDER BY created_at DESC`,
    args: []
  });
  const out = [];
  for (const inv of result.rows) {
    const total = Number(inv.total_amount) - Number(inv.discount || 0) + Number(inv.tax || 0);
    const paid = await getTotalPaidForInvoice(inv.id);
    const balance = total - paid;
    if (balance > 0) {
      out.push({ invoice_id: inv.id, patient_id: inv.patient_id, total, paid, balance });
    }
  }
  return out;
}

export async function getTotalOutstanding() {
  const balances = await getOutstandingBalances();
  return balances.reduce((sum, b) => sum + b.balance, 0);
}

// ---------- Expenses ----------
export async function getExpenses(filters = {}) {
  const database = getDb();
  const { fromDate, toDate, offset = 0 } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM expenses WHERE 1=1';
  const args = [];
  if (fromDate) { sql += ' AND date >= ?'; args.push(fromDate); }
  if (toDate) { sql += ' AND date <= ?'; args.push(toDate); }
  sql += ' ORDER BY date DESC, id DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function createExpense(data) {
  const database = getDb();
  const result = await database.execute({
    sql: `INSERT INTO expenses (description, amount, category, date) VALUES (?, ?, ?, ?)`,
    args: [data.description, data.amount, data.category || 'General', data.date]
  });
  return Number(result.lastInsertRowid);
}

export async function deleteExpense(id) {
  return await getDb().execute({ sql: 'DELETE FROM expenses WHERE id = ?', args: [id] });
}

export async function getDailyExpenses(date) {
  const result = await getDb().execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date = ?`,
    args: [date]
  });
  return result.rows[0] ? Number(result.rows[0].total) : 0;
}

export async function getMonthlyExpenses(yearMonth) {
  const result = await getDb().execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE strftime('%Y-%m', date) = ?`,
    args: [yearMonth]
  });
  return result.rows[0] ? Number(result.rows[0].total) : 0;
}

export async function getRevenueRange(startDate, endDate) {
  const result = await getDb().execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date(paid_at) BETWEEN ? AND ?`,
    args: [startDate, endDate]
  });
  return result.rows[0] ? Number(result.rows[0].total) : 0;
}

export async function getExpenseRange(startDate, endDate) {
  const result = await getDb().execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date BETWEEN ? AND ?`,
    args: [startDate, endDate]
  });
  return result.rows[0] ? Number(result.rows[0].total) : 0;
}

// ---------- Settings ----------
export async function getSetting(key) {
  const result = await getDb().execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] });
  return result.rows[0] ? result.rows[0].value : null;
}

export async function getAllSettings() {
  const result = await getDb().execute({ sql: 'SELECT key, value, updated_at FROM settings ORDER BY key', args: [] });
  return result.rows;
}

export async function setSetting(key, value) {
  return await getDb().execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value]
  });
}

export async function deleteSetting(key) {
  return await getDb().execute({ sql: 'DELETE FROM settings WHERE key = ?', args: [key] });
}

// ---------- Communication Logs ----------
export async function logCommunication(data) {
  const result = await getDb().execute({
    sql: `INSERT INTO communication_logs (appointment_id, patient_id, patient_name, patient_phone, type, channel, status, message, error, sent_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      data.appointment_id ?? null, data.patient_id ?? null, data.patient_name ?? null,
      data.patient_phone ?? null, data.type, data.channel, data.status,
      data.message ?? null, data.error ?? null
    ]
  });
  return Number(result.lastInsertRowid);
}

export async function getCommunicationLogs(filters = {}) {
  const database = getDb();
  const { offset = 0, patient_id, appointment_id, type, status } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM communication_logs WHERE 1=1';
  const args = [];
  if (patient_id) { sql += ' AND patient_id = ?'; args.push(patient_id); }
  if (appointment_id) { sql += ' AND appointment_id = ?'; args.push(appointment_id); }
  if (type) { sql += ' AND type = ?'; args.push(type); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  sql += ' ORDER BY sent_at DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getCommunicationStats() {
  const database = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const [todayRes, totalRes, byChannelRes, byStatusRes, recentRes] = await Promise.all([
    database.execute({ sql: 'SELECT COUNT(*) as count FROM communication_logs WHERE date(sent_at) = ?', args: [today] }),
    database.execute({ sql: 'SELECT COUNT(*) as count FROM communication_logs', args: [] }),
    database.execute({ sql: 'SELECT channel, COUNT(*) as count FROM communication_logs GROUP BY channel', args: [] }),
    database.execute({ sql: 'SELECT status, COUNT(*) as count FROM communication_logs GROUP BY status', args: [] }),
    database.execute({ sql: 'SELECT * FROM communication_logs ORDER BY sent_at DESC LIMIT 20', args: [] }),
  ]);
  return {
    today: todayRes.rows[0]?.count || 0,
    total: totalRes.rows[0]?.count || 0,
    byChannel: byChannelRes.rows,
    byStatus: byStatusRes.rows,
    recent: recentRes.rows,
  };
}

// ---------- Users ----------
export async function getUsers(filters = {}) {
  const database = getDb();
  const { offset = 0, role } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT id, email, role, created_at FROM users WHERE 1=1';
  const args = [];
  if (role) { sql += ' AND role = ?'; args.push(role); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getUserById(id) {
  const result = await getDb().execute({ sql: 'SELECT id, email, role, created_at FROM users WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function getUserByEmail(email) {
  const result = await getDb().execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
  return result.rows[0];
}

export async function createUser(data) {
  const database = getDb();
  const hash = await bcrypt.hash(data.password, 10);
  const result = await database.execute({
    sql: 'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
    args: [data.email.toLowerCase().trim(), hash, data.role || 'staff']
  });
  return Number(result.lastInsertRowid);
}

export async function updateUser(id, data) {
  const database = getDb();
  const user = await getUserById(id);
  if (!user) return null;

  const updates = [];
  const args = [];

  if (data.email) { updates.push('email = ?'); args.push(data.email.toLowerCase().trim()); }
  if (data.role) { updates.push('role = ?'); args.push(data.role); }
  if (data.password) {
    const hash = await bcrypt.hash(data.password, 10);
    updates.push('password = ?');
    args.push(hash);
  }

  if (updates.length === 0) return user;

  args.push(id);
  await database.execute({ sql: `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, args });
  return getUserById(id);
}

export async function deleteUser(id) {
  return await getDb().execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] });
}

// ---------- Audit Logs ----------
export async function logAudit(data) {
  const result = await getDb().execute({
    sql: `INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.user_id ?? null, data.user_email ?? null, data.action, data.entity_type,
      data.entity_id ?? null,
      data.old_values ? JSON.stringify(data.old_values) : null,
      data.new_values ? JSON.stringify(data.new_values) : null,
      data.ip_address ?? null, data.user_agent ?? null
    ]
  });
  return Number(result.lastInsertRowid);
}

export async function getAuditLogs(filters = {}) {
  const database = getDb();
  const { offset = 0, user_id, entity_type, action } = filters;
  const lim = Math.min(Number(filters.limit) || 100, 500);
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const args = [];
  if (user_id) { sql += ' AND user_id = ?'; args.push(user_id); }
  if (entity_type) { sql += ' AND entity_type = ?'; args.push(entity_type); }
  if (action) { sql += ' AND action = ?'; args.push(action); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  args.push(lim, Number(offset) || 0);
  const result = await database.execute({ sql, args });
  return result.rows;
}

export async function getAuditStats() {
  const database = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const [todayRes, totalRes, byActionRes, byEntityRes, recentRes] = await Promise.all([
    database.execute({ sql: 'SELECT COUNT(*) as count FROM audit_logs WHERE date(created_at) = ?', args: [today] }),
    database.execute({ sql: 'SELECT COUNT(*) as count FROM audit_logs', args: [] }),
    database.execute({ sql: 'SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action', args: [] }),
    database.execute({ sql: 'SELECT entity_type, COUNT(*) as count FROM audit_logs GROUP BY entity_type', args: [] }),
    database.execute({ sql: 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50', args: [] }),
  ]);
  return {
    today: todayRes.rows[0]?.count || 0,
    total: totalRes.rows[0]?.count || 0,
    byAction: byActionRes.rows,
    byEntity: byEntityRes.rows,
    recent: recentRes.rows,
  };
}
