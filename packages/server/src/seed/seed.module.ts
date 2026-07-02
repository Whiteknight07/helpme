import { Module } from '@nestjs/common';
import { SeedController } from './seed.controller';
import { SeedService } from './seed.service';
import { FactoryService } from 'factory/factory.service';
import { SeedChatbotAgentGroupCommand } from './seed-chatbot-agent-group.command';
import { CourseService } from 'course/course.service';
import { ChatbotApiService } from 'chatbot/chatbot-api.service';

@Module({
  controllers: [SeedController],
  providers: [
    SeedService,
    FactoryService,
    SeedChatbotAgentGroupCommand,
    CourseService,
    ChatbotApiService,
  ],
})
export class SeedModule {}
