import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User, UserSchema } from '../common/schema/user';
import { Voucher, VoucherSchema } from '../common/schema/voucher';
import { UsageEvent, UsageEventSchema } from '../common/schema/usage-event';
import { MongooseModule } from '@nestjs/mongoose';
import { EncryptionService } from '../common/utils/encryption.service';
import { HttpModule } from '@nestjs/axios';
import { IndexingModule } from 'src/indexing/indexing.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Voucher.name, schema: VoucherSchema },
      { name: UsageEvent.name, schema: UsageEventSchema },
    ]),
    forwardRef(() => IndexingModule),
  ],
  controllers: [UsersController],
  providers: [UsersService, EncryptionService],
  exports: [UsersService],
})
export class UsersModule {}
