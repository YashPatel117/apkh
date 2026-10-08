import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IntegrationToken,
  IntegrationTokenSchema,
} from 'src/common/schema/integration-token';
import { IndexingModule } from 'src/indexing/indexing.module';
import { NotesModule } from 'src/notes/notes.module';
import { SearchModule } from 'src/search/search.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IntegrationToken.name, schema: IntegrationTokenSchema },
    ]),
    NotesModule,
    SearchModule,
    IndexingModule,
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
