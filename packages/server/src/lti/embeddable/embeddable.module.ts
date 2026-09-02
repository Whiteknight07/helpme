import { Module } from '@nestjs/common';
import { ChatbotModule } from '../../chatbot/chatbot.module';
import { EmbeddableQuestionController } from './question/embeddable-question.controller';
import { EmbeddableQuestionService } from './question/embeddable-question.service';

@Module({
  imports: [ChatbotModule],
  controllers: [EmbeddableQuestionController],
  providers: [EmbeddableQuestionService],
  exports: [EmbeddableQuestionService],
})
export class EmbeddableModule {}
