import { getDb } from './db.js';

export async function runExpenseMigrations(db) {
    await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  `);
}

const db = getDb();
runExpenseMigrations(db).then(() => {
  console.log('Expense table migration complete.');
}).catch(console.error);
