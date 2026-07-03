// Migration script to add reminder tracking columns to appointments table
// Run with: node server/migrate-reminders.js

import 'dotenv/config';
import { getDb } from './db.js';

const db = getDb();

console.log('Running reminder columns migration...');

async function runMigration() {
    try {
        // Add reminder tracking columns if they don't exist
        const columns = [
            { name: 'reminder_sent_at', type: 'TEXT' },
            { name: 'thank_you_sent_at', type: 'TEXT' },
            { name: 'reminder_1day_sent_at', type: 'TEXT' },
            { name: 'reminder_6h_sent_at', type: 'TEXT' },
            { name: 'reminder_1h_sent_at', type: 'TEXT' },
        ];

        for (const col of columns) {
            try {
                await db.execute(`ALTER TABLE appointments ADD COLUMN ${col.name} ${col.type}`);
                console.log(`✓ Added column: ${col.name}`);
            } catch (e) {
                if (e.message.includes('duplicate column name')) {
                    console.log(`✓ Column already exists: ${col.name}`);
                } else {
                    console.error(`✗ Error adding column ${col.name}:`, e.message);
                }
            }
        }

        // Also add status column if missing
        try {
            await db.execute(`ALTER TABLE appointments ADD COLUMN status TEXT DEFAULT 'Scheduled'`);
            console.log('✓ Added column: status');
        } catch (e) {
            if (e.message.includes('duplicate column name')) {
                console.log('✓ Column already exists: status');
            } else {
                console.error('✗ Error adding column status:', e.message);
            }
        }

        // Also add patient_id column if missing (for linking to patients table)
        try {
            await db.execute(`ALTER TABLE appointments ADD COLUMN patient_id INTEGER`);
            console.log('✓ Added column: patient_id');
        } catch (e) {
            if (e.message.includes('duplicate column name')) {
                console.log('✓ Column already exists: patient_id');
            } else {
                console.error('✗ Error adding column patient_id:', e.message);
            }
        }

        // Also add duration_minutes column if missing
        try {
            await db.execute(`ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER DEFAULT 30`);
            console.log('✓ Added column: duration_minutes');
        } catch (e) {
            if (e.message.includes('duplicate column name')) {
                console.log('✓ Column already exists: duration_minutes');
            } else {
                console.error('✗ Error adding column duration_minutes:', e.message);
            }
        }

        console.log('\nMigration completed successfully!');
    } catch (e) {
        console.error('Migration failed:', e);
        process.exit(1);
    }
}

runMigration();
