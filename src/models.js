// Mongoose models for Tenant, Customer, Conversation, Message
import mongoose from "mongoose";
const { Schema } = mongoose;

/**
 * Tenant schema - per-tenant WhatsApp config
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
 * Customer - tenant scoped
 */
const customerSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    waId: { type: String, required: true },
    name: { type: String },
    lastSeenAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
});
customerSchema.index({ tenantId: 1, waId: 1 }, { unique: true });

/**
 * Conversation (light)
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
 * Message - idempotency rule per tenant
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
messageSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } });

export const Tenant = mongoose.model("Tenant", tenantSchema);
export const Customer = mongoose.model("Customer", customerSchema);
export const Conversation = mongoose.model("Conversation", conversationSchema);
export const Message = mongoose.model("Message", messageSchema);
