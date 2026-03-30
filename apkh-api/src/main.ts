import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = new DocumentBuilder()
    .setTitle('APKH API')
    .setDescription('The APKH API description')
    .setVersion('1.0')
    .addTag('apkh')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({
    origin: 'http://localhost:3002', // Next.js frontend
    credentials: true, // allows cookies & auth headers
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
