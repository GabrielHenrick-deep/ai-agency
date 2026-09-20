import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aiagent';

export const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });

let ready = false;

export function isDbReady(): boolean {
  return ready;
}

/** Cria as tabelas se não existirem. Nunca derruba o servidor se o banco estiver fora do ar. */
export async function initDb(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id SERIAL PRIMARY KEY,
        topic TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS turns (
        id SERIAL PRIMARY KEY,
        meeting_id INT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        text TEXT NOT NULL,
        position INT NOT NULL
      );
    `);
    // estado compartilhado entre dispositivos (PC e celular): sessions, settings, agentes…
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    ready = true;
    console.log('Postgres conectado: atas + estado compartilhado serão salvos');
  } catch (error: any) {
    console.warn('Postgres indisponível (atas NÃO serão salvas):', error.message);
    console.warn('Suba com: docker compose up -d');
  }
}
