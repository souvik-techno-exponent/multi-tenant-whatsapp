import dotenv from "dotenv";
dotenv.config();
import app from "./app";
import { connectWithRetry } from "./db";

const PORT = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
    await connectWithRetry();
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log('working')
    });
}

start().catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
});
