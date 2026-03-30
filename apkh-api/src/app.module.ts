import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import * as dotenv from 'dotenv';
import { JwtModule } from '@nestjs/jwt';
import { NotesModule } from './notes/notes.module';
import { JwtSecretKey } from './common/constant/jwt';
import { FileModule } from './file/file.module';
dotenv.config();

@Module({
  imports: [
    MongooseModule.forRoot(
      'mongodb+srv://yp7112003_db_user:YeKd5huDb9ozI8Rg@apkh-v1.vbuvkfe.mongodb.net/apkh?retryWrites=true&w=majority',
    ),
    UsersModule,
    AuthModule,
    JwtModule.register({
      global: true,
      secret: JwtSecretKey,
      signOptions: { expiresIn: '7d' },
    }),
    NotesModule,
    FileModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
