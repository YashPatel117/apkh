import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { NotesModule } from './notes/notes.module';
import { JwtSecretKey } from './common/constant/jwt';
import { requireEnv } from './common/constant/env';
import { FileModule } from './file/file.module';
import { ChatModule } from './chat/chat.module';
import { DatabaseModule } from './database/database.module';
import { IndexingModule } from './indexing/indexing.module';

@Module({
  imports: [
    MongooseModule.forRoot(requireEnv('MONGODB_URI')),
    // Data migrations run while modules initialise, before the index worker
    // starts (application bootstrap) and before requests are served.
    DatabaseModule,
    UsersModule,
    AuthModule,
    JwtModule.register({
      global: true,
      secret: JwtSecretKey,
      signOptions: { expiresIn: '7d' },
    }),
    NotesModule,
    FileModule,
    ChatModule,
    IndexingModule,
  ],
})
export class AppModule {}
