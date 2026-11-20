import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildGeminiCameraRequest,
  CameraSemanticAnalyzer,
  cameraSemanticAnalyzerReadiness,
  parseCameraVideoSemantic,
} from '../src/modules/camera-recording/camera-semantic-analyzer';

const neutralPayload = {
  language: 'pt-BR',
  eventRelevant: true,
  description: 'Duas pessoas caminharam da esquerda para a direita, enquanto um carro cinza passou no sentido contrário.',
  confidence: 0.88,
  facts: ['person_passed', 'vehicle_passed'],
  observations: [
    {
      subject: 'person',
      count: 2,
      color: 'unknown',
      direction: 'left_to_right',
      actions: ['walked', 'passed'],
      firstSeenSecond: 4,
      lastSeenSecond: 10,
      confidence: 0.91,
      evidence: 'Duas pessoas atravessam a imagem a pé.',
    },
    {
      subject: 'car',
      count: 1,
      color: 'gray',
      direction: 'right_to_left',
      actions: ['passed'],
      firstSeenSecond: 5,
      lastSeenSecond: 9,
      confidence: 0.86,
      evidence: 'Um carro cinza passa atrás das pessoas no sentido oposto.',
    },
  ],
  risk: {
    level: 'low',
    score: 12,
    category: 'ordinary',
    reasons: ['Passagem normal, sem aproximação do portão.'],
  },
  securitySignals: [],
  uncertainties: [],
};

test('semantic cloud analysis requires opt-in consent and a non-blank personal key', () => {
  assert.deepEqual(cameraSemanticAnalyzerReadiness({
    CAMERA_SEMANTIC_ANALYSIS_ENABLED: 'true',
    CAMERA_SEMANTIC_CLOUD_CONSENT: 'false',
    GEMINI_API_KEY: 'personal-key',
  }), {
    requested: true,
    consented: false,
    hasApiKey: true,
    enabled: false,
    reason: 'consent_required',
  });

  assert.equal(cameraSemanticAnalyzerReadiness({
    CAMERA_SEMANTIC_ANALYSIS_ENABLED: 'true',
    CAMERA_SEMANTIC_CLOUD_CONSENT: 'true',
    GEMINI_API_KEY: '   ',
  }).reason, 'api_key_required');
});

test('disabled semantic analysis never calls the provider', async () => {
  let calls = 0;
  const analyzer = new CameraSemanticAnalyzer({
    env: {
      CAMERA_SEMANTIC_ANALYSIS_ENABLED: 'true',
      CAMERA_SEMANTIC_CLOUD_CONSENT: 'true',
      GEMINI_API_KEY: ' ',
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response();
    },
  });

  await assert.rejects(
    analyzer.analyze('/file/does/not/exist.mp4', 'Camera Frente'),
    /camera_semantic_api_key_required/,
  );
  assert.equal(calls, 0);
});

test('Gemini request uses full video at high resolution, 5 FPS and deterministic generation', () => {
  const request = buildGeminiCameraRequest('video-base64', 'Camera Frente', 5) as {
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
    generation_config: { temperature: number };
  };
  const video = request.contents[0].parts[0] as {
    inline_data: { data: string };
    video_metadata: { fps: number };
    media_resolution: { level: string };
  };

  assert.equal(video.inline_data.data, 'video-base64');
  assert.equal(video.video_metadata.fps, 5);
  assert.equal(video.media_resolution.level, 'MEDIA_RESOLUTION_HIGH');
  assert.equal(request.generation_config.temperature, 0);
  assert.equal(JSON.stringify(request).includes('GEMINI_API_KEY'), false);
  const prompt = String(request.contents[0].parts[1].text);
  assert.match(prompt, /ciclista ou motociclista é um único ator/i);
  assert.match(prompt, /deduplique o mesmo ator/i);
  assert.match(prompt, /deslocamento entre a primeira e a última posição/i);
  assert.match(prompt, /passagem normal pela rua.+não é aproximação/i);
  assert.match(prompt, /eventRelevant=false, observations=\[\]/);
});

test('parses a factual multi-object event for later Alexa queries', () => {
  const semantic = parseCameraVideoSemantic(neutralPayload, 'gemini-3.6-flash', 5);

  assert.equal(semantic.description, neutralPayload.description);
  assert.deepEqual(semantic.facts, ['person_passed', 'vehicle_passed']);
  assert.deepEqual(semantic.observations.map((item) => item.count), [2, 1]);
  assert.equal(semantic.risk.level, 'low');
});

test('rejects English descriptions even when the payload claims pt-BR', () => {
  assert.throws(
    () => parseCameraVideoSemantic({
      ...neutralPayload,
      description: 'Two cyclists and one person passed in front of the gate, moving from right to left on the street.',
    }, 'gemini-3.6-flash', 5),
    /camera_semantic_language_invalid/,
  );
});

test('rejects English evidence and reasons outside the main description', () => {
  assert.throws(
    () => parseCameraVideoSemantic({
      ...neutralPayload,
      observations: [{
        ...neutralPayload.observations[0],
        evidence: 'Two people walked in front of the gate.',
      }],
      risk: {
        ...neutralPayload.risk,
        reasons: ['Normal passing without stopping near the property.'],
      },
    }, 'gemini-3.6-flash', 5),
    /camera_semantic_language_invalid/,
  );
});

test('keeps unknown visual details neutral instead of inventing them', () => {
  const semantic = parseCameraVideoSemantic({
    ...neutralPayload,
    description: 'Uma pessoa passou diante da câmera.',
    facts: ['person_passed'],
    observations: [{
      ...neutralPayload.observations[0],
      count: 1,
      color: 'unknown',
      direction: 'unknown',
      actions: ['unknown'],
      evidence: 'A pessoa aparece em vários quadros; cor e direção não são nítidas.',
    }],
    uncertainties: ['Cor e direção não puderam ser confirmadas.'],
  }, 'gemini-3.6-flash', 5);

  assert.equal(semantic.observations[0].color, 'unknown');
  assert.equal(semantic.observations[0].direction, 'unknown');
  assert.equal(semantic.uncertainties.length, 1);
});

test('rejects contradictory observations and irrelevant events with relevant facts', () => {
  const invalidObservations = [
    {
      ...neutralPayload.observations[0],
      actions: ['passed', 'unknown'],
    },
    {
      ...neutralPayload.observations[0],
      actions: ['maneuvered'],
    },
    {
      ...neutralPayload.observations[0],
      direction: 'stationary',
      actions: ['passed'],
    },
  ];

  for (const observation of invalidObservations) {
    assert.throws(
      () => parseCameraVideoSemantic({
        ...neutralPayload,
        observations: [observation],
      }, 'gemini-3.6-flash', 5),
      /camera_semantic_payload_invalid/,
    );
  }

  assert.throws(
    () => parseCameraVideoSemantic({
      ...neutralPayload,
      eventRelevant: false,
      observations: [],
      facts: ['vehicle_passed', 'no_relevant_event'],
    }, 'gemini-3.6-flash', 5),
    /camera_semantic_payload_invalid/,
  );
});

test('accepts an irrelevant event only without observations or relevant facts', () => {
  const semantic = parseCameraVideoSemantic({
    ...neutralPayload,
    eventRelevant: false,
    description: 'Somente chuva e reflexos foram observados.',
    observations: [],
    facts: ['weather_only', 'no_relevant_event'],
    risk: {
      level: 'none',
      score: 0,
      category: 'ordinary',
      reasons: ['Não houve movimento relevante.'],
    },
  }, 'gemini-3.6-flash', 5);

  assert.equal(semantic.eventRelevant, false);
  assert.deepEqual(semantic.observations, []);
});

test('rejects accusatory labels and structurally incomplete responses', () => {
  assert.throws(
    () => parseCameraVideoSemantic({
      ...neutralPayload,
      description: 'Uma pessoa suspeita passou diante da casa.',
    }, 'gemini-3.6-flash', 5),
    /camera_semantic_payload_invalid/,
  );
  const { risk: _risk, ...missingRisk } = neutralPayload;
  assert.throws(
    () => parseCameraVideoSemantic(missingRisk, 'gemini-3.6-flash', 5),
    /camera_semantic_payload_invalid/,
  );
});

test('neutralizes generic suspicious wording without labeling a person', () => {
  const semantic = parseCameraVideoSemantic({
    ...neutralPayload,
    risk: {
      ...neutralPayload.risk,
      reasons: ['Passagem normal, sem atitude suspeita ou aproximação do portão.'],
    },
  }, 'gemini-3.6-flash', 5);

  assert.equal(semantic.risk.reasons[0].includes('suspeit'), false);
  assert.match(semantic.risk.reasons[0], /sem comportamento de risco/i);
});

test('high risk is downgraded without a strong evidenced signal', () => {
  const semantic = parseCameraVideoSemantic({
    ...neutralPayload,
    risk: {
      level: 'high',
      score: 78,
      category: 'security',
      reasons: ['Uma pessoa caminhou perto do portão.'],
    },
  }, 'gemini-3.6-flash', 5);

  assert.equal(semantic.risk.level, 'medium');
  assert.equal(semantic.risk.score, 60);
});

test('provider key stays in the request header and never enters semantic metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-semantic-'));
  const videoPath = join(root, 'event.mp4');
  writeFileSync(videoPath, 'video');
  let capturedHeaders: HeadersInit | undefined;
  const analyzer = new CameraSemanticAnalyzer({
    env: {
      CAMERA_SEMANTIC_ANALYSIS_ENABLED: 'true',
      CAMERA_SEMANTIC_CLOUD_CONSENT: 'true',
      GEMINI_API_KEY: 'personal-test-key',
    },
    fetchImpl: async (_input, init) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(neutralPayload) }] } }],
      }), { status: 200 });
    },
  });

  try {
    const semantic = await analyzer.analyze(videoPath, 'Camera Frente');
    assert.equal((capturedHeaders as Record<string, string>)['x-goog-api-key'], 'personal-test-key');
    assert.equal(JSON.stringify(semantic).includes('personal-test-key'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fallback Gemini 2.5 request omits unsupported media resolution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-semantic-fallback-'));
  const videoPath = join(root, 'event.mp4');
  writeFileSync(videoPath, 'video');
  const calls: Array<{ input: string; body: string }> = [];
  const analyzer = new CameraSemanticAnalyzer({
    env: {
      CAMERA_SEMANTIC_ANALYSIS_ENABLED: 'true',
      CAMERA_SEMANTIC_CLOUD_CONSENT: 'true',
      CAMERA_SEMANTIC_MODEL: 'gemini-3.6-flash',
      CAMERA_SEMANTIC_FALLBACK_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'personal-test-key',
    },
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), body: String(init?.body) });
      if (String(input).includes('gemini-3.6-flash')) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{}' }] } }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(neutralPayload) }] } }],
      }), { status: 200 });
    },
  });

  try {
    const semantic = await analyzer.analyze(videoPath, 'Camera Frente');
    const fallbackRequest = JSON.parse(calls[1].body) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    assert.equal(semantic.analyzer.model, 'gemini-2.5-flash');
    assert.equal('media_resolution' in fallbackRequest.contents[0].parts[0], false);
    assert.deepEqual(fallbackRequest.contents[0].parts[0].video_metadata, { fps: 5 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses the fallback model when the first model responds in English', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-semantic-language-fallback-'));
  const videoPath = join(root, 'event.mp4');
  writeFileSync(videoPath, 'video');
  const calls: string[] = [];
  const analyzer = new CameraSemanticAnalyzer({
    env: {
      CAMERA_SEMANTIC_ANALYSIS_ENABLED: 'true',
      CAMERA_SEMANTIC_CLOUD_CONSENT: 'true',
      CAMERA_SEMANTIC_MODEL: 'gemini-3.6-flash',
      CAMERA_SEMANTIC_FALLBACK_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'personal-test-key',
    },
    fetchImpl: async (input) => {
      calls.push(String(input));
      const payload = String(input).includes('gemini-3.6-flash')
        ? {
            ...neutralPayload,
            description: 'Two cyclists passed in front of the gate.',
          }
        : neutralPayload;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      }), { status: 200 });
    },
  });

  try {
    const semantic = await analyzer.analyze(videoPath, 'Camera Frente');
    assert.equal(semantic.analyzer.model, 'gemini-2.5-flash');
    assert.equal(semantic.description, neutralPayload.description);
    assert.equal(calls.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('HTTP 429 tries each model once without immediate retry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-semantic-rate-limit-'));
  const videoPath = join(root, 'event.mp4');
  writeFileSync(videoPath, 'video');
  const calls: string[] = [];
  let sleeps = 0;
  const analyzer = new CameraSemanticAnalyzer({
    env: {
      CAMERA_SEMANTIC_ANALYSIS_ENABLED: 'true',
      CAMERA_SEMANTIC_CLOUD_CONSENT: 'true',
      CAMERA_SEMANTIC_MODEL: 'gemini-3.6-flash',
      CAMERA_SEMANTIC_FALLBACK_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'personal-test-key',
    },
    fetchImpl: async (input) => {
      calls.push(String(input));
      return new Response('', { status: 429 });
    },
    sleep: async () => {
      sleeps += 1;
    },
  });

  try {
    await assert.rejects(
      analyzer.analyze(videoPath, 'Camera Frente'),
      /camera_semantic_http_429/,
    );
    assert.equal(calls.length, 2);
    assert.equal(calls.filter((url) => url.includes('gemini-3.6-flash')).length, 1);
    assert.equal(calls.filter((url) => url.includes('gemini-2.5-flash')).length, 1);
    assert.equal(sleeps, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('larger clips use the temporary Files API and are deleted after analysis', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-has-semantic-file-'));
  const videoPath = join(root, 'long-event.mp4');
  writeFileSync(videoPath, Buffer.alloc(1024 * 1024 + 1, 1));
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const analyzer = new CameraSemanticAnalyzer({
    env: {
      CAMERA_SEMANTIC_ANALYSIS_ENABLED: 'true',
      CAMERA_SEMANTIC_CLOUD_CONSENT: 'true',
      CAMERA_SEMANTIC_INLINE_MAX_VIDEO_MB: '1',
      CAMERA_SEMANTIC_MAX_VIDEO_MB: '2',
      GEMINI_API_KEY: 'personal-test-key',
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ input: url, init });
      if (url.endsWith('/upload/v1beta/files')) {
        return new Response('', {
          status: 200,
          headers: {
            'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files/session-1',
          },
        });
      }
      if (url.endsWith('/upload/v1beta/files/session-1')) {
        return new Response(JSON.stringify({
          file: {
            name: 'files/event-1',
            uri: 'https://generativelanguage.googleapis.com/v1beta/files/event-1',
            state: 'ACTIVE',
          },
        }), { status: 200 });
      }
      if (init?.method === 'DELETE') return new Response('', { status: 200 });
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(neutralPayload) }] } }],
      }), { status: 200 });
    },
  });

  try {
    const semantic = await analyzer.analyze(videoPath, 'Camera Frente');
    const generationBody = String(calls[2].init?.body);
    assert.equal(semantic.eventRelevant, true);
    assert.match(generationBody, /"file_uri":"https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/event-1"/);
    assert.equal(generationBody.includes('personal-test-key'), false);
    assert.equal(calls[3].init?.method, 'DELETE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
