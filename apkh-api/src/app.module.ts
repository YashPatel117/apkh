import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { NotesModule } from './notes/notes.module';
import { JwtSecretKey } from './common/constant/jwt';
import { requireEnv } from './common/constant/env';
import { FileModule } from './file/file.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    MongooseModule.forRoot(requireEnv('MONGODB_URI')),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
