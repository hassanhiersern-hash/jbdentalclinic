/**
 * Extension migrations: new tables and columns only.
 * Does not modify or remove existing appointments table or its existing columns.
 * Converted to async @libsql/client patterns.
 */
export async function runExtensionMigrations(database) {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const hasMigration = async (name) => {
    const res = await database.execute({ sql: 'SELECT 1 FROM schema_migrations WHERE name = ?', args: [name] });
    return res.rows.length > 0;
  };
  const addMigration = async (name) => {
    await database.execute({ sql: 'INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)', args: [name] });
  };

  if (!await hasMigration('patients')) {
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
    await addMigration('patients');
  }

  if (!await hasMigration('staff')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        salary REAL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role)`);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(is_active)`);
    await addMigration('staff');
  }

  if (!await hasMigration('appointments_extra_columns')) {
    // libsql: PRAGMA table_info is supported
    const info = await database.execute({ sql: 'PRAGMA table_info(appointments)', args: [] });
    const cols = info.rows.map((c) => c.name);
    const hasCol = (name) => cols.includes(name);
    if (!hasCol('patient_id')) await database.execute(`ALTER TABLE appointments ADD COLUMN patient_id INTEGER REFERENCES patients(id)`);
    if (!hasCol('dentist_id')) await database.execute(`ALTER TABLE appointments ADD COLUMN dentist_id INTEGER REFERENCES staff(id)`);
    if (!hasCol('status')) await database.execute(`ALTER TABLE appointments ADD COLUMN status TEXT DEFAULT 'Pending'`);
    await addMigration('appointments_extra_columns');
  }

  if (!await hasMigration('appointments_email_reminders')) {
    const info = await database.execute({ sql: 'PRAGMA table_info(appointments)', args: [] });
    const cols = info.rows.map((c) => c.name);
    const hasCol = (name) => cols.includes(name);
    if (!hasCol('thank_you_email_sent_at')) await database.execute(`ALTER TABLE appointments ADD COLUMN thank_you_email_sent_at TEXT`);
    if (!hasCol('reminder_1day_email_sent_at')) await database.execute(`ALTER TABLE appointments ADD COLUMN reminder_1day_email_sent_at TEXT`);
    if (!hasCol('reminder_6h_email_sent_at')) await database.execute(`ALTER TABLE appointments ADD COLUMN reminder_6h_email_sent_at TEXT`);
    if (!hasCol('reminder_1h_email_sent_at')) await database.execute(`ALTER TABLE appointments ADD COLUMN reminder_1h_email_sent_at TEXT`);
    await addMigration('appointments_email_reminders');
  }

  if (!await hasMigration('treatment_plans')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS treatment_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        total_estimated_cost REAL,
        status TEXT DEFAULT 'Active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient ON treatment_plans(patient_id)`);
    await addMigration('treatment_plans');
  }

  if (!await hasMigration('treatments')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS treatments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        dentist_id INTEGER REFERENCES staff(id),
        treatment_plan_id INTEGER REFERENCES treatment_plans(id),
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
    await addMigration('treatments');
  }

  if (!await hasMigration('dental_chart')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS dental_chart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        tooth_number TEXT NOT NULL,
        condition TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_dental_chart_patient ON dental_chart(patient_id)`);
    await addMigration('dental_chart');
  }

  if (!await hasMigration('invoices')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        total_amount REAL NOT NULL,
        discount REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        status TEXT DEFAULT 'Pending',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id)`);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at)`);
    await addMigration('invoices');
  }

  if (!await hasMigration('payments')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        paid_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)`);
    await addMigration('payments');
  }

  if (!await hasMigration('patient_reports')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS patient_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        doctor_id INTEGER REFERENCES staff(id),
        report_date TEXT NOT NULL,
        chief_complaint TEXT,
        clinical_findings TEXT,
        diagnosis TEXT,
        treatment_plan TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_patient_reports_patient ON patient_reports(patient_id)`);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_patient_reports_date ON patient_reports(report_date)`);
    await addMigration('patient_reports');
  }

  if (!await hasMigration('users')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await addMigration('users');
  }

  if (!await hasMigration('inventory_items')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        quantity INTEGER DEFAULT 0,
        minimum_stock INTEGER DEFAULT 0,
        supplier TEXT,
        last_updated TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory_items(name)`);
    await addMigration('inventory_items');
  }

  if (!await hasMigration('expenses')) {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT DEFAULT 'General',
        date TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)`);
    await addMigration('expenses');
  }
}
