import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export type VoucherDocument = Voucher & Document;

/**
 * A one-time code that moves its redeemer to the Pro plan. Codes are
 * "XXXX-XXXX" (stored with the dash); create them with `npm run vouchers:create`.
 */
@Schema({ timestamps: true, collection: 'vouchers' })
export class Voucher {
  @Prop({ required: true, unique: true })
  code: string;

  @Prop({ default: false })
  redeemed: boolean;

  @Prop()
  redeemedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  redeemedBy?: Types.ObjectId;
}

export const VoucherSchema = SchemaFactory.createForClass(Voucher);
