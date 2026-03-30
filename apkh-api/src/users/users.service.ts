import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../common/schema/user';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(name: string, email: string, password: string): Promise<User> {
    const newUser = new this.userModel({ name, email, password });
    return newUser.save();
  }

  async findOne(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: username }).exec();
  }

  async findOneById(userId: string): Promise<UserDocument | null> {
    return await this.userModel.findOne({ _id: userId }).exec();
  }

  async updatePassword(email: string, passwordHash: string): Promise<UserDocument | null> {
    return this.userModel.findOneAndUpdate({ email }, { password: passwordHash }, { new: true }).exec();
  }
}
