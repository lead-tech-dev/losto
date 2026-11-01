// Chiffre les données de santé encore en clair (lignes créées avant l'activation du chiffrement).
// Sans risque à relancer : seules les valeurs sans préfixe « enc:v1: » sont traitées. Lancé à chaque démarrage.
import { Pool } from 'pg';
import { encrypt, ENCRYPTED_COLUMNS } from './crypto';

export async function encryptExisting(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl });
  let total = 0;
  try {
    for (const [table, column] of ENCRYPTED_COLUMNS) {
      const { rows } = await pool.query<{ id: string; v: string }>(
        `select id, "${column}" as v from "${table}" where "${column}" is not null and "${column}" not like 'enc:v1:%'`,
      );
      for (const r of rows) {
        await pool.query(`update "${table}" set "${column}" = $1 where id = $2 and "${column}" = $3`, [encrypt(r.v), r.id, r.v]);
      }
      total += rows.length;
    }
  } finally {
    await pool.end();
  }
  return total;
}

if (require.main === module) {
  encryptExisting(process.env.DATABASE_URL ?? '')
    .then((n) => console.log(`Données de santé chiffrées : ${n} valeur${n > 1 ? 's' : ''} déjà en clair`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
