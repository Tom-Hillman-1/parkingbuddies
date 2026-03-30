import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("Missing DATABASE_URL environment variable.");
}

export const pool = new Pool({ connectionString });
