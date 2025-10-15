// server entrypoint
import dotenv from "dotenv";
dotenv.config();
import app from "./app.js";
import { connectWithRetry } from "./db.js";

const PORT = process.env.PORT || 3000;

async function start() {
    console.log("working fine");
    await connectWithRetry();
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

start().catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
});
