// mongoose connection with simple retry logic for dev containers
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/pocdb";

async function connectWithRetry(retries = 10, delayMs = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(MONGO_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            console.log("MongoDB connected");
            return;
        } catch (err) {
            console.warn(`Mongo connect attempt ${i + 1} failed - retrying in ${delayMs}ms`);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw new Error("Unable to connect to MongoDB");
}

export { connectWithRetry };
