import { defineConfig } from 'drizzle-kit';

// drizzle-kit lit le schéma TypeScript et génère les migrations SQL dans ./drizzle
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
