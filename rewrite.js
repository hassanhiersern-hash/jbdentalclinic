const fs = require('fs');
const path = require('path');

const remindersPath = path.join(__dirname, 'server/routes/reminders.js');
let code = fs.readFileSync(remindersPath, 'utf8');

// markReminderSent / markEmailReminderSent
code = code.replace(/const stmt = db\.prepare\(`([\s\S]*?)`\);\s*return stmt\.run\(appointmentId\);/g, 
  "return await db.execute({ sql: `$1`, args: [appointmentId] });");

// getAppointmentEmail
code = code.replace(/const row = db\.prepare\('SELECT email FROM patients WHERE id = \?'\)\.get\(pid\);\s*if \(row\?\.email\) return String\(row\.email\)\.trim\(\);/g, 
  "const res = await db.execute({ sql: 'SELECT email FROM patients WHERE id = ?', args: [pid] });\n    if (res.rows[0]?.email) return String(res.rows[0].email).trim();");
code = code.replace(/const row = db\.prepare\('SELECT email FROM patients WHERE phone = \? LIMIT 1'\)\.get\(phone\);\s*if \(row\?\.email\) return String\(row\.email\)\.trim\(\);/g, 
  "const res = await db.execute({ sql: 'SELECT email FROM patients WHERE phone = ? LIMIT 1', args: [phone] });\n    if (res.rows[0]?.email) return String(res.rows[0].email).trim();");

// all send functions queries
code = code.replace(/const stmt = db\.prepare\(`([\s\S]*?)`\);\s*const appointments = stmt\.all\((.*?)\);/g, (match, sql, args) => {
  if (!args.trim()) {
    return `const res = await db.execute({ sql: \`${sql}\`, args: [] });\n  const appointments = res.rows;`;
  }
  return `const res = await db.execute({ sql: \`${sql}\`, args: [${args}] });\n  const appointments = res.rows;`;
});

fs.writeFileSync(remindersPath, code);
console.log('reminders.js rewritten');

const reportsPath = path.join(__dirname, 'server/routes/reports.js');
let reports = fs.readFileSync(reportsPath, 'utf8');

// Convert all routes to async
reports = reports.replace(/router\.get\('\/([^']+)', \(req, res\) => {/g, "router.get('/$1', async (req, res) => {");

// Add await to db calls
const dbFuncs = ['getAppointments', 'getInvoices', 'getTreatments', 'getDailyRevenue', 'getMonthlyRevenue', 'getTotalOutstanding', 'getOutstandingBalances', 'getLowStockItems', 'getExpenses', 'getMonthlyExpenses', 'getExpenseRange', 'getRevenueRange', 'getDailyExpenses'];

for (const func of dbFuncs) {
  const regex = new RegExp(`(?<!await )${func}\\(`, 'g');
  reports = reports.replace(regex, `await ${func}(`);
}

reports = reports.replace(/getDb\(\)\.prepare\('SELECT COUNT\(\*\) AS n FROM patients'\)\.get\(\)\?\.n/g, "(await getDb().execute('SELECT COUNT(*) AS n FROM patients')).rows[0]?.n");

// /cashbook route
reports = reports.replace(/const entries = db\.prepare\(combinedSQL\)\.all\(\.\.\.allParams\);/g, "const entriesRes = await db.execute({ sql: combinedSQL, args: allParams });\n    const entries = entriesRes.rows;");
reports = reports.replace(/const totalIncome = db\.prepare\(totalIncomeSQL\)\.get\(\.\.\.params\)\?\.total/g, "const totalIncomeRes = await db.execute({ sql: totalIncomeSQL, args: params });\n    const totalIncome = totalIncomeRes.rows[0]?.total");
reports = reports.replace(/const totalExpenses = db\.prepare\(totalExpenseSQL\)\.get\(\.\.\.params\)\?\.total/g, "const totalExpenseRes = await db.execute({ sql: totalExpenseSQL, args: params });\n    const totalExpenses = totalExpenseRes.rows[0]?.total");

// /profit-loss route
reports = reports.replace(/const incomeByMethod = db\.prepare\(incomeByMethodSQL\)\.all\(\.\.\.params\);/g, "const incomeByMethod = (await db.execute({ sql: incomeByMethodSQL, args: params })).rows;");
reports = reports.replace(/const expensesByCategory = db\.prepare\(expByCatSQL\)\.all\(\.\.\.params\);/g, "const expensesByCategory = (await db.execute({ sql: expByCatSQL, args: params })).rows;");
reports = reports.replace(/const recentIncome = db\.prepare\(recentIncomeSQL\)\.all\(\.\.\.params\);/g, "const recentIncome = (await db.execute({ sql: recentIncomeSQL, args: params })).rows;");
reports = reports.replace(/const recentExpenses = db\.prepare\(recentExpenseSQL\)\.all\(\.\.\.params\);/g, "const recentExpenses = (await db.execute({ sql: recentExpenseSQL, args: params })).rows;");

fs.writeFileSync(reportsPath, reports);
console.log('reports.js rewritten');
