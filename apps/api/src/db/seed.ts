// Données de départ (relançable sans risque) : npm run db:seed
// - le premier compte admin
// - une liste de départ de quartiers couverts, à ajuster selon les partenaires réellement recrutés
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { normalizeKey } from '../common/text';
import { City, coverageZones, Role, users } from './schema';

const STARTER_ZONES: Record<Exclude<City, 'OTHER'>, string[]> = {
  DOUALA: ['Akwa', 'Bonanjo', 'Bonapriso', 'Deïdo', 'Bali', 'Bonamoussadi', 'Makepe', 'Kotto', 'Logpom', 'Bépanda', 'Ndokotti', 'Bonabéri'],
  YAOUNDE: ['Bastos', 'Centre-ville', 'Mvog-Mbi', 'Essos', 'Nlongkak', 'Omnisport', 'Emana', 'Biyem-Assi', 'Mendong', 'Ekounou', 'Mimboman', 'Melen'],
};

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
    } else {
      await db.insert(users).values({
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: Role.ADMIN,
        firstName: 'Admin',
        lastName: 'Proche Santé',
      });
      console.log(`Admin créé : ${email}`);
    }

    const rows = Object.entries(STARTER_ZONES).flatMap(([city, districts]) =>
      districts.map((district) => ({ city: city as City, district, districtKey: normalizeKey(district) })),
    );
    const inserted = await db.insert(coverageZones).values(rows).onConflictDoNothing().returning();
    console.log(`Quartiers couverts ajoutés : ${inserted.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
