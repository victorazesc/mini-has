import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {

  const app = await NestFactory.create(AppModule);

  app.enableCors({

    origin: '*',

    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    allowedHeaders: ['Content-Type', 'Authorization'],

  });

  const port = Number(process.env.PORT || 8000);

  await app.listen(port, '0.0.0.0');

  console.log(`Server running on http://localhost:${port}`);

}

void bootstrap();