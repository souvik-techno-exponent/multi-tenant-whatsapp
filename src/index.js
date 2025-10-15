import app from "./app.js";
import { connectDb } from "./db.js";
import "./worker.js"; // start worker in same process for PoC (in prod run separately)
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3000;

async function start() {
    await connectDb();
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

start().catch((err) => {
    console.error("Failed to start", err);
    process.exit(1);
});
