import dotenv from "dotenv";
dotenv.config();
import { connectWithRetry } from "./db";
import { startWorker } from "./worker";

async function start(): Promise<void> {
    await connectWithRetry();
    startWorker();
}

start().catch((err) => {
    console.error("Worker failed to start", err);
    process.exit(1);
});
