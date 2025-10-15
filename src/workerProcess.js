// separate worker entrypoint for container
import dotenv from "dotenv";
dotenv.config();
import { connectWithRetry } from "./db.js";
import { startWorker } from "./worker.js";

async function start() {
    await connectWithRetry();
    startWorker();
}

start().catch((err) => {
    console.error("Worker failed to start", err);
    process.exit(1);
});
