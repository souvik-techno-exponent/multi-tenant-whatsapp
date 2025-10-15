// Mongoose models for Tenant, Customer, Conversation, Message
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Tenant model stores per-tenant config (phoneNumberId, encrypted token).
 */
const tenantSchema = new Schema({
    name: { type: String, required: true },
    phoneNumberId: { type: String, required: true, unique: true },
    wabaId: { type: String },
    accessTokenEnc: { type: String, required: true },
    status: { type: String, default: "connected" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

tenantSchema.pre("save", function (next) {
    this.updatedAt = Date.now();
    next();
});

/**
 * Customer model stores customer info scoped to tenant.
 */
const customerSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    waId: { type: String, required: true }, // E.164
    name: { type: String },
    lastSeenAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
});

// ensure tenantId + waId lookup is fast
customerSchema.index({ tenantId: 1, waId: 1 }, { unique: true });

/**
 * Conversation model (light)
 */
const conversationSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    customerWaId: { type: String, required: true },
    status: { type: String, default: "open" },
    lastMessageAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
});
conversationSchema.index({ tenantId: 1, customerWaId: 1 });

/**
 * Message model
 * idempotency: unique per-tenant if idempotencyKey present
 */
const messageSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId },
    direction: { type: String, enum: ["IN", "OUT"], required: true },
    waMessageId: { type: String },
    body: { type: String },
    type: { type: String, default: "text" },
    idempotencyKey: { type: String, sparse: true },
    status: { type: String }, // queued|sent|delivered|read|failed
    createdAt: { type: Date, default: Date.now },
});

// Unique idempotency per tenant (only when idempotencyKey exists)
messageSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } });

export const Tenant = mongoose.model("Tenant", tenantSchema);
export const Customer = mongoose.model("Customer", customerSchema);
export const Conversation = mongoose.model("Conversation", conversationSchema);
export const Message = mongoose.model("Message", messageSchema);
