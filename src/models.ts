import mongoose, { Schema, InferSchemaType, Types, model } from "mongoose";

/** Tenant schema */
const tenantSchema = new Schema(
    {
        name: { type: String, required: true },
        phoneNumberId: { type: String, required: true, unique: true },
        wabaId: { type: String },
        accessTokenEnc: { type: String, required: true },
        status: { type: String, default: "connected" },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

tenantSchema.pre("save", function (next) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this as mongoose.Document & { updatedAt?: Date };
    self.updatedAt = new Date();
    next();
});

/** Customer schema */
const customerSchema = new Schema(
    {
        tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
        waId: { type: String, required: true },
        name: { type: String },
        lastSeenAt: { type: Date },
        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);
customerSchema.index({ tenantId: 1, waId: 1 }, { unique: true });

/** Conversation schema */
const conversationSchema = new Schema(
    {
        tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
        customerWaId: { type: String, required: true },
        status: { type: String, default: "open" },
        lastMessageAt: { type: Date },
        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);
conversationSchema.index({ tenantId: 1, customerWaId: 1 });

/** Message schema */
const messageSchema = new Schema(
    {
        tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
        conversationId: { type: Schema.Types.ObjectId },
        direction: { type: String, enum: ["IN", "OUT"], required: true },
        waMessageId: { type: String },
        body: { type: String },
        type: { type: String, default: "text" },
        idempotencyKey: { type: String, sparse: true },
        status: { type: String }, // queued|sent|delivered|read|failed|received
        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);
messageSchema.index(
    { tenantId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } }
);

// Types
export type TenantDoc = InferSchemaType<typeof tenantSchema> & { _id: Types.ObjectId };
export type CustomerDoc = InferSchemaType<typeof customerSchema> & { _id: Types.ObjectId };
export type ConversationDoc = InferSchemaType<typeof conversationSchema> & { _id: Types.ObjectId };
export type MessageDoc = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId };

// Models
export const Tenant = model<TenantDoc>("Tenant", tenantSchema);
export const Customer = model<CustomerDoc>("Customer", customerSchema);
export const Conversation = model<ConversationDoc>("Conversation", conversationSchema);
export const Message = model<MessageDoc>("Message", messageSchema);
