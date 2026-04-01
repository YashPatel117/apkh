export interface ILlmConfig {
  keyName: string;
  llmModel: string;
  isActive: boolean;
  tokensUsed: number;
  createdAt: string;
}

export interface IUser {
  id: string;
  email: string;
  name: string;
  type: string;
  totalTokensUsed: number;
  llmConfigs: ILlmConfig[];
}

