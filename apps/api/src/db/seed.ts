// Crée le premier compte admin (une fois, après la migration) : npm run db:seed
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Role, users } from './schema';

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  if (!email || password.length < 8) {
    throw new Error('Définir SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD (8 caractères minimum) dans .env');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  try {
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      console.log(`Admin déjà présent : ${email}`);
      return;
    }
    await db.insert(users).values({
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: Role.ADMIN,
      firstName: 'Admin',
      lastName: 'Proche Santé',
    });
    console.log(`Admin créé : ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
