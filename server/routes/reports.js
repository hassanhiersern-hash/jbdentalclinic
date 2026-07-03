import { Router } from 'express';
import {
  getDailyRevenue,
  getMonthlyRevenue,
  getRevenueRange,
  getOutstandingBalances,
  getTotalOutstanding,
  getExpenses,
  createExpense,
  deleteExpense,
  getDailyExpenses,
  getMonthlyExpenses,
  getExpenseRange,
  getAppointments,
  getDb,
  getInvoices,
  getLowStockItems,
  getTreatments
} from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ message: 'Reports API', available_endpoints: ['/balance-sheet', '/dashboard', '/daily-revenue', '/monthly-revenue', '/outstanding', '/expenses'] });
});

router.get('/balance-sheet', async (req, res) => {
  try {
    const { type, date } = req.query; // type: daily, weekly, monthly
    const targetDate = date || new Date().toISOString().slice(0, 10);

    let revenue = 0;
    let expense = 0;
    let period = '';

    if (type === 'monthly') {
      const month = targetDate.slice(0, 7);
      revenue = await getMonthlyRevenue(month);
      expense = await getMonthlyExpenses(month);
      period = `Month: ${month}`;
    } else if (type === 'weekly') {
      const d = new Date(targetDate);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const start = new Date(d.setDate(diff)).toISOString().slice(0, 10);
      const end = new Date(d.setDate(diff + 6)).toISOString().slice(0, 10);

      revenue = await getRevenueRange(start, end);
      expense = await getExpenseRange(start, end);
      period = `Week: ${start} to ${end}`;
    } else {
      revenue = await getDailyRevenue(targetDate);
      expense = await getDailyExpenses(targetDate);
      period = `Date: ${targetDate}`;
    }

    res.json({
      period,
      revenue,
      expenses: expense,
      balance: revenue - expense
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    // Get today's appointments
    const todayAppointments = await getAppointments({ fromDate: today, toDate: today, limit: 100 });

    // Get total patient count efficiently
    const totalPatients = (await getDb().execute('SELECT COUNT(*) AS n FROM patients')).rows[0]?.n || 0;

    // Get pending invoices
    const pendingInvoices = await getInvoices({ status: 'Pending', limit: 100 });

    // Get low stock items
    const lowStockItems = await getLowStockItems();

    // Get recent treatments
    const recentTreatments = await getTreatments({ limit: 10 });

    // Get financial data
    const daily = await getDailyRevenue(today);
    const monthly = await getMonthlyRevenue(thisMonth);
    const outstanding = await getTotalOutstanding();
    const balances = await getOutstandingBalances();

    res.json({
      // Appointments
      today_appointments_count: Array.isArray(todayAppointments) ? todayAppointments.length : 0,
      today_appointments: Array.isArray(todayAppointments) ? todayAppointments.slice(0, 5) : [],

      // Patients
      total_patients: totalPatients,

      // Invoices
      pending_invoices_count: Array.isArray(pendingInvoices) ? pendingInvoices.length : 0,

      // Inventory
      low_stock_count: Array.isArray(lowStockItems) ? lowStockItems.length : 0,
      low_stock_items: Array.isArray(lowStockItems) ? lowStockItems.slice(0, 5) : [],

      // Treatments
      recent_treatments: Array.isArray(recentTreatments) ? recentTreatments : [],

      // Financial
      daily_revenue: daily,
      monthly_revenue: monthly,
      total_outstanding: outstanding,
      outstanding_balances: balances,

      as_of: today,
      month: thisMonth,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/daily-revenue', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const total = await getDailyRevenue(date);
    res.json({ date, revenue: total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/monthly-revenue', async (req, res) => {
  try {
    const yearMonth = req.query.month || new Date().toISOString().slice(0, 7);
    const total = await getMonthlyRevenue(yearMonth);
    res.json({ month: yearMonth, revenue: total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/outstanding', async (req, res) => {
  try {
    const balances = await getOutstandingBalances();
    const total = await getTotalOutstanding();
    res.json({ total_outstanding: total, items: balances });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Expenses
router.get('/expenses', async (req, res) => {
  try {
    const { fromDate, toDate, limit } = req.query;
    const expenses = await getExpenses({ fromDate, toDate, limit });
    res.json(expenses);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cashbook: combined income (payments) + expenses timeline
router.get('/cashbook', async (req, res) => {
  try {
    const { from_date, to_date, limit = 200, offset = 0 } = req.query;
    const db = getDb();

    // Build date filter
    let dateFilter = '';
    const params = [];
    if (from_date) { dateFilter += ' AND date >= ?'; params.push(from_date); }
    if (to_date) { dateFilter += ' AND date <= ?'; params.push(to_date); }

    // Get payments as income entries (joined with invoices + patients)
    const incomeSQL = `
      SELECT 
        p.id, date(p.paid_at) AS date, p.amount, p.payment_method AS method,
        'income' AS type,
        COALESCE(pt.full_name, 'Patient #' || i.patient_id) AS description,
        'INV-' || i.id AS reference
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN patients pt ON i.patient_id = pt.id
      WHERE 1=1 ${dateFilter.replace(/date/g, "date(p.paid_at)")}
    `;

    // Get expenses
    const expenseSQL = `
      SELECT 
        id, date, amount, category AS method,
        'expense' AS type,
        description,
        'EXP-' || id AS reference
      FROM expenses
      WHERE 1=1 ${dateFilter}
    `;

    // Union and sort
    const combinedSQL = `
      SELECT * FROM (${incomeSQL} UNION ALL ${expenseSQL})
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `;

    const allParams = [...params, ...params, Math.min(Number(limit), 500), Number(offset) || 0];
    const entriesRes = await db.execute({ sql: combinedSQL, args: allParams });
    const entries = entriesRes.rows;

    // Get totals for the period
    const totalIncomeSQL = `SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p WHERE 1=1 ${dateFilter.replace(/date/g, "date(p.paid_at)")}`;
    const totalExpenseSQL = `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE 1=1 ${dateFilter}`;

    const totalIncomeRes = await db.execute({ sql: totalIncomeSQL, args: params });
    const totalIncome = totalIncomeRes.rows[0]?.total || 0;
    const totalExpenseRes = await db.execute({ sql: totalExpenseSQL, args: params });
    const totalExpenses = totalExpenseRes.rows[0]?.total || 0;

    res.json({
      entries,
      summary: {
        total_income: totalIncome,
        total_expenses: totalExpenses,
        net_balance: totalIncome - totalExpenses,
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Profit & Loss: detailed income + expense breakdown
router.get('/profit-loss', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const db = getDb();

    let dateFilter = '';
    const params = [];
    if (from_date) { dateFilter += ' AND date >= ?'; params.push(from_date); }
    if (to_date) { dateFilter += ' AND date <= ?'; params.push(to_date); }

    // Income by payment method
    const incomeByMethodSQL = `
      SELECT p.payment_method AS label, COALESCE(SUM(p.amount), 0) AS amount, COUNT(*) AS count
      FROM payments p
      WHERE 1=1 ${dateFilter.replace(/date/g, "date(p.paid_at)")}
      GROUP BY p.payment_method ORDER BY amount DESC
    `;
    const incomeByMethod = (await db.execute({ sql: incomeByMethodSQL, args: params })).rows;

    // Total income
    const totalIncomeSQL = `SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p WHERE 1=1 ${dateFilter.replace(/date/g, "date(p.paid_at)")}`;
    const totalIncomeRes = await db.execute({ sql: totalIncomeSQL, args: params });
    const totalIncome = totalIncomeRes.rows[0]?.total || 0;

    // Expenses by category
    const expByCatSQL = `
      SELECT category AS label, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
      FROM expenses
      WHERE 1=1 ${dateFilter}
      GROUP BY category ORDER BY amount DESC
    `;
    const expensesByCategory = (await db.execute({ sql: expByCatSQL, args: params })).rows;

    // Total expenses
    const totalExpenseSQL = `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE 1=1 ${dateFilter}`;
    const totalExpenseRes = await db.execute({ sql: totalExpenseSQL, args: params });
    const totalExpenses = totalExpenseRes.rows[0]?.total || 0;

    // Recent income entries (payments)
    const recentIncomeSQL = `
      SELECT p.id, date(p.paid_at) AS date, p.amount, p.payment_method,
        COALESCE(pt.full_name, 'Patient #' || i.patient_id) AS patient_name,
        'INV-' || i.id AS reference
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN patients pt ON i.patient_id = pt.id
      WHERE 1=1 ${dateFilter.replace(/date/g, "date(p.paid_at)")}
      ORDER BY p.paid_at DESC LIMIT 50
    `;
    const recentIncome = (await db.execute({ sql: recentIncomeSQL, args: params })).rows;

    // Recent expense entries
    const recentExpenseSQL = `
      SELECT id, date, amount, category, description
      FROM expenses
      WHERE 1=1 ${dateFilter}
      ORDER BY date DESC LIMIT 50
    `;
    const recentExpenses = (await db.execute({ sql: recentExpenseSQL, args: params })).rows;

    res.json({
      income: {
        total: totalIncome,
        by_method: incomeByMethod,
        recent: recentIncome,
      },
      expenses: {
        total: totalExpenses,
        by_category: expensesByCategory,
        recent: recentExpenses,
      },
      gross_income: totalIncome,
      total_expenses: totalExpenses,
      net_profit: totalIncome - totalExpenses,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/expenses', (req, res) => {
  try {
    const { description, amount, category, date } = req.body;
    const errs = [];
    if (!description || typeof description !== 'string' || !description.trim()) {
      errs.push('description is required');
    }
    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      errs.push('amount must be a positive number');
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errs.push('date must be in YYYY-MM-DD format');
    }
    if (errs.length) {
      return res.status(400).json({ error: 'Validation failed', details: errs });
    }
    const id = createExpense({ description: description.trim(), amount: numAmount, category, date });
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/expenses/:id', (req, res) => {
  try {
    deleteExpense(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
