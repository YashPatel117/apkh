import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AnswerFeedback,
  AnswerFeedbackSchema,
} from 'src/common/schema/answer-feedback';
import { UsersModule } from 'src/users/users.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AnswerFeedback.name, schema: AnswerFeedbackSchema },
    ]),
    UsersModule,
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
