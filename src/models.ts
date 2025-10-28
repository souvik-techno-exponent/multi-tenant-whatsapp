import mongoose, { Schema, InferSchemaType, Types, model } from "mongoose";
import { MatchType } from "./conversation/types";

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

/** Template schema (per-tenant) */
const templateSchema = new Schema(
    {
        tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
        key: { type: String, required: true }, // e.g. "welcome", "otp", "fallback"
        body: { type: String, required: true }, // e.g. "Hi {{name}}, your OTP is {{otp}}"
        kind: {
            type: String,
            enum: ["text", "interactive_button"],
            default: "text",
            required: true,
        },
        buttons: [{
            id: { type: String, required: true },        // stable payload we will get back from WhatsApp
            title: { type: String, required: true },     // label user sees in WhatsApp

            // branching info:
            nextTemplateKey: { type: String },           // which template to send next automatically
            nextState: { type: String },                 // optional conversation state transition
        }],
        description: { type: String },
        variables: [{ type: String }], // e.g. ["name","otp"]
        isActive: { type: Boolean, default: true },
        version: { type: Number, default: 1 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);
templateSchema.index({ tenantId: 1, key: 1 }, { unique: true });
templateSchema.pre("save", function (next) {
     
    const self = this as mongoose.Document & { updatedAt?: Date };
    self.updatedAt = new Date();
    next();
});

/** Flow schema (per-tenant) */
const flowSchema = new Schema(
    {
        tenantId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
        // Simple DSL: array of rules: { when: { type: "regex"|"contains", value: string }, action: { replyTemplateKey, setState? } }
        rules: [
            {
                when: {
                    // Mongoose needs the underlying constructor type, not a TS enum.
                    // Constrain with enum to allowed values from MatchType.
                    type: { type: String, enum: Object.values(MatchType), required: true },
                    value: { type: String, required: true }
                },
                action: {
                    replyTemplateKey: { type: String, required: true },
                    setState: { type: String } // e.g. "awaiting_email"
                }
            }
        ],
        fallbackTemplateKey: { type: String }, // optional fallback
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);
flowSchema.pre("save", function (next) {
     
    const self = this as mongoose.Document & { updatedAt?: Date };
    self.updatedAt = new Date();
    next();
});

/** ConversationState schema (per tenant, per customer) */
const conversationStateSchema = new Schema(
    {
        tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
        customerWaId: { type: String, required: true }, // E.164
        state: { type: String, default: "default" }, // free-form state label
        lastTemplateKey: { type: String },
        updatedAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);
conversationStateSchema.index({ tenantId: 1, customerWaId: 1 }, { unique: true });
conversationStateSchema.pre("save", function (next) {
     
    const self = this as mongoose.Document & { updatedAt?: Date };
    self.updatedAt = new Date();
    next();
});


// Strongly-typed rule shape for use with `.lean<...>()`
export type FlowRule = {
    when: { type: MatchType; value: string };
    action: { replyTemplateKey: string; setState?: string };
};
export type FlowDocStrict = Omit<FlowDoc, "rules"> & { rules: FlowRule[] };

export type TemplateDoc = InferSchemaType<typeof templateSchema> & { _id: Types.ObjectId };
export type FlowDoc = InferSchemaType<typeof flowSchema> & { _id: Types.ObjectId };
export type ConversationStateDoc = InferSchemaType<typeof conversationStateSchema> & { _id: Types.ObjectId };

export const Template = model<TemplateDoc>("Template", templateSchema);
export const Flow = model<FlowDoc>("Flow", flowSchema);
export const ConversationState = model<ConversationStateDoc>("ConversationState", conversationStateSchema);

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
