// Applique les migrations SQL du dossier ./drizzle à la base : npm run db:migrate
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'path';
import { Pool } from 'pg';

export async function runMigrations(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations(process.env.DATABASE_URL ?? '')
    .then(() => console.log('Migrations appliquées'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
