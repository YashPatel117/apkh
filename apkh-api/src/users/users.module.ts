import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User, UserSchema } from '../common/schema/user';
import { MongooseModule } from '@nestjs/mongoose';
import { EncryptionService } from '../common/utils/encryption.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, EncryptionService],
  exports: [UsersService],
})
export class UsersModule {}
