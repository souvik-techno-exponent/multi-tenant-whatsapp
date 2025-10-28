import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI ?? "mongodb://localhost:27017/pocdb";

export async function connectWithRetry(retries = 10, delayMs = 2000): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(MONGO_URI, {
                serverSelectionTimeoutMS: 5000
            });
            console.log("MongoDB connected");
            return;
        } catch (err) {
            console.warn(`Mongo connect attempt ${i + 1} failed - retrying in ${delayMs}ms`);
            console.log(err)
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw new Error("Unable to connect to MongoDB");
}
