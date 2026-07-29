import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configDotenv } from 'dotenv';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

type BodyParserFactory = (options: Record<string, unknown>) => any;

const { json, urlencoded } = require('express') as {
  json: BodyParserFactory;
  urlencoded: BodyParserFactory;
};

configDotenv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  app.use(json({ limit: process.env.MINI_HAS_BODY_LIMIT || '25mb' }));
  app.use(urlencoded({ extended: true, limit: process.env.MINI_HAS_BODY_LIMIT || '25mb' }));

  const allowedOrigins = String(process.env.MINI_HAS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-CSRF-Token',
        'MCP-Protocol-Version',
      ],
      credentials: true,
    });
  }

  if (process.env.MINI_HAS_API_DOCS === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Mini-HAS API')
      .setDescription('API do Mini-HAS para automação residencial')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    app.use(
      '/reference',
      apiReference({
        spec: {
          content: document,
        },
      }),
    );
  }

  const port = Number(process.env.PORT || 8000);
  const host = process.env.HOST || '0.0.0.0';

  await app.listen(port, host);

  console.log(`Server running on http://${host}:${port}`);
  if (process.env.MINI_HAS_API_DOCS === 'true') {
    console.log(`Scalar running on http://${host}:${port}/reference`);
  }
}

void bootstrap();
