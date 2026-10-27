import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  AnswerFeedback,
  AnswerFeedbackDocument,
  type FeedbackKind,
} from 'src/common/schema/answer-feedback';
import { errorMessage } from 'src/common/utils/http-error';
import { UsersService } from 'src/users/users.service';

// How much of a question / answer / comment is kept with a vote
const MAX_QUERY_CHARS = 1000;
const MAX_ANSWER_CHARS = 4000;
const MAX_COMMENT_CHARS = 1000;

export interface FeedbackInput {
  kind: FeedbackKind;
  answerKey: string;
  helpful: boolean;
  query?: string;
  answer?: string;
  comment?: string;
  sourceCount?: number;
  sessionId?: string;
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectModel(AnswerFeedback.name)
    private feedbackModel: Model<AnswerFeedbackDocument>,
    private readonly usersService: UsersService,
  ) {}

  /** Record (or change) a user's vote on an answer. */
  async vote(userId: string, input: FeedbackInput) {
    // The model the answer most likely came from: the one active now.
    let model: string | undefined;
    let provider: string | undefined;
    try {
      const llm = await this.usersService.getActiveLlmSettings(userId);
      model = llm?.model;
      provider = llm?.provider;
    } catch (error) {
      this.logger.warn(`No model for feedback: ${errorMessage(error)}`);
    }
    const comment = input.comment?.trim().slice(0, MAX_COMMENT_CHARS);
    await this.feedbackModel.updateOne(
      { userId: new Types.ObjectId(userId), answerKey: input.answerKey },
      {
        $set: {
          kind: input.kind,
          helpful: input.helpful,
          query: (input.query ?? '').slice(0, MAX_QUERY_CHARS),
          answer: (input.answer ?? '').slice(0, MAX_ANSWER_CHARS),
          sourceCount: input.sourceCount ?? 0,
          model,
          provider,
          ...(input.sessionId && isValidObjectId(input.sessionId)
            ? { sessionId: new Types.ObjectId(input.sessionId) }
            : {}),
          // A vote without a comment keeps the comment given earlier.
          ...(comment ? { comment } : {}),
        },
      },
      { upsert: true },
    );
    return { recorded: true };
  }
}
