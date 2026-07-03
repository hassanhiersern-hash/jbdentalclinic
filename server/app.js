import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, getDb } from './db.js';
import { requireAdmin, requireApiKey, requireRoles } from './middleware/auth.js';
import { loginLimiter, apiLimiter } from './middleware/rate-limit.js';
import appointments from './routes/appointments.js';
import reminders from './routes/reminders.js';
import patients from './routes/patients.js';
import staff from './routes/staff.js';
import treatments from './routes/treatments.js';
import treatmentPlans from './routes/treatment-plans.js';
import dentalChart from './routes/dental-chart.js';
import invoices from './routes/invoices.js';
import payments from './routes/payments.js';
import inventory from './routes/inventory.js';
import reports from './routes/reports.js';
import patientReports from './routes/patient-reports.js';
import adminAuth from './routes/admin-auth.js';
import seed from './routes/seed.js';
import settings from './routes/settings.js';
import communicationLogs from './routes/communication-logs.js';
import users from './routes/users.js';
import auditLogs from './routes/audit-logs.js';
import search from './routes/search.js';
import { validateAdminConfig } from './config/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function initializeServerState() {
  console.log('[STARTUP] Initializing database...');
  validateAdminConfig();

  initDb().then(() => {
    console.log('[STARTUP] Database connection and migrations verified successfully.');
  }).catch((err) => {
    console.error('[STARTUP] Database connection failed:', err);
  });
}

function configureFrontend(app) {
  let frontendPath = null;
  const possiblePaths = ['dist', 'public', 'client/build', 'build'];

  for (const relativePath of possiblePaths) {
    const fullPath = path.resolve(__dirname, '..', relativePath);
    if (!frontendPath && fs.existsSync(fullPath)) {
      frontendPath = fullPath;
      console.log(`Frontend detected at: ${relativePath}`);
    }
  }

  if (frontendPath) {
    app.use(express.static(frontendPath));
    app.get('*', (req, res) => {
      const indexPath = path.join(frontendPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(200).send('JB Dental Clinic API running');
      }
    });
    return;
  }

  app.get('/', (req, res) => {
    res.status(200).send('JB Dental Clinic API running');
  });
}

export function createApp() {
  initializeServerState();

  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '1mb' }));
  app.use(
    cors({
      origin: isProd ? process.env.CORS_ORIGIN || undefined : true,
      credentials: true,
    })
  );

  app.use('/api', apiLimiter);

  app.use('/api/appointments', requireApiKey, requireRoles('admin', 'receptionist', 'dentist', 'staff'), appointments);
  app.use('/api/send-reminders', requireApiKey, requireRoles('admin', 'receptionist', 'staff'), reminders);
  app.use('/api/patients', requireApiKey, requireRoles('admin', 'receptionist', 'dentist', 'staff'), patients);
  app.use('/api/staff', requireApiKey, requireRoles('admin', 'staff'), staff);
  app.use('/api/treatments', requireApiKey, requireRoles('admin', 'dentist', 'staff'), treatments);
  app.use('/api/treatment-plans', requireApiKey, requireRoles('admin', 'dentist', 'staff'), treatmentPlans);
  app.use('/api/dental-chart', requireApiKey, requireRoles('admin', 'dentist', 'staff'), dentalChart);
  app.use('/api/invoices', requireApiKey, requireRoles('admin', 'receptionist', 'staff'), invoices);
  app.use('/api/payments', requireApiKey, requireRoles('admin', 'receptionist', 'staff'), payments);
  app.use('/api/inventory', requireApiKey, requireRoles('admin', 'staff'), inventory);
  app.use('/api/reports', requireApiKey, requireRoles('admin', 'dentist', 'staff'), reports);
  app.use('/api/patient-reports', requireApiKey, requireRoles('admin', 'dentist', 'staff'), patientReports);
  app.use('/api/settings', requireApiKey, requireAdmin, settings);
  app.use('/api/communication-logs', requireApiKey, requireRoles('admin', 'staff'), communicationLogs);
  app.use('/api/users', requireApiKey, requireAdmin, users);
  app.use('/api/audit-logs', requireApiKey, requireAdmin, auditLogs);
  app.use('/api/search', requireApiKey, requireRoles('admin', 'receptionist', 'dentist', 'staff'), search);
  app.use('/api/admin', loginLimiter, adminAuth);
  app.use('/api/seed', requireApiKey, requireAdmin, seed);

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  configureFrontend(app);

  return app;
}
