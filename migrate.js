// One-time migration: copies all data from the local SQLite file (carmanager.db)
// into Supabase, keeping the original ids so relations stay intact.
// Run AFTER creating the tables with supabase-schema.sql:
//   npm run migrate
const Database = require('better-sqlite3');
const path = require('path');
const supabase = require('./supabase');

const sqlite = new Database(path.join(__dirname, 'carmanager.db'), { readonly: true });

async function copyTable(table, rows) {
  if (!rows.length) {
    console.log(`${table}: nothing to copy`);
    return;
  }
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: copied ${rows.length} rows`);
}

async function main() {
  await copyTable('users', sqlite.prepare('SELECT name,username,password_hash FROM users').all());
  await copyTable('cars', sqlite.prepare('SELECT * FROM cars').all());
  await copyTable(
    'maintenance_logs',
    sqlite
      .prepare('SELECT * FROM maintenance_logs')
      .all()
      .map((r) => ({ ...r, is_service: !!r.is_service }))
  );
  await copyTable('parking_locations', sqlite.prepare('SELECT * FROM parking_locations').all());

  // Bump the auto-increment counters past the migrated ids
  const { error } = await supabase.rpc('sync_id_sequences');
  if (error) throw new Error(`sync_id_sequences: ${error.message}`);

  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
