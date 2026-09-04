import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ChatbotModule } from '../../chatbot/chatbot.module';
import { EmbeddableQuestionController } from './question/embeddable-question.controller';
import { EmbeddableQuestionService } from './question/embeddable-question.service';
import { EmbeddableResourceController } from './resource/embeddable-resource.controller';
import { EmbeddableResourceGuard } from './resource/embeddable-resource.guard';

@Module({
  imports: [
    ChatbotModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [EmbeddableQuestionController, EmbeddableResourceController],
  providers: [EmbeddableQuestionService, EmbeddableResourceGuard],
  exports: [EmbeddableQuestionService],
})
export class EmbeddableModule {}
