import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatSession, ChatSessionSchema } from 'src/common/schema/chat-session';
import { IndexJob, IndexJobSchema } from 'src/common/schema/index-job';
import { Note, NoteSchema } from 'src/common/schema/note';
import { UsageEvent, UsageEventSchema } from 'src/common/schema/usage-event';
import { User, UserSchema } from 'src/common/schema/user';
import { Voucher, VoucherSchema } from 'src/common/schema/voucher';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Note.name, schema: NoteSchema },
      { name: ChatSession.name, schema: ChatSessionSchema },
      { name: IndexJob.name, schema: IndexJobSchema },
      { name: Voucher.name, schema: VoucherSchema },
      { name: UsageEvent.name, schema: UsageEventSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
