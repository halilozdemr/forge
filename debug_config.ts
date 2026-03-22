import "dotenv/config";
import { loadConfig } from "./src/utils/config.js";

console.log("CWD:", process.cwd());
console.log("DATABASE_URL from env:", process.env.DATABASE_URL);
const config = loadConfig();
console.log("Config databaseUrl:", config.databaseUrl);
