import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Folder, FolderSchema } from 'src/common/schema/folder';
import {
  FolderMember,
  FolderMemberSchema,
} from 'src/common/schema/folder-member';
import { Note, NoteSchema } from 'src/common/schema/note';
import {
  AppNotification,
  NotificationSchema,
} from 'src/common/schema/notification';
import { User, UserSchema } from 'src/common/schema/user';
import { AccessService } from './access.service';
import { CollabController } from './collab.controller';
import { CollabService } from './collab.service';
import { NotificationsService } from './notifications.service';

/**
 * Shared folders (members, roles, invites), access checks for everything in
 * them, and in-app notifications. Global: notes, folders, files, search and
 * chat all ask AccessService who may see what.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Folder.name, schema: FolderSchema },
      { name: FolderMember.name, schema: FolderMemberSchema },
      { name: Note.name, schema: NoteSchema },
      { name: User.name, schema: UserSchema },
      { name: AppNotification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [CollabController],
  providers: [AccessService, CollabService, NotificationsService],
  exports: [AccessService, CollabService, NotificationsService],
})
export class CollabModule {}
