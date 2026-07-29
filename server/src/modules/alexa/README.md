# Alexa Smart Home

Adaptador Alexa v3 do Mini HAS. Ele expõe:

- luzes, interruptores e ventiladores por `Alexa.PowerController`;
- persianas por `Alexa.RangeController` (`Blind.Lift`);
- cenas por `Alexa.SceneController`;
- consulta por `Alexa.ReportState`.

A escala da persiana é convertida: Alexa `100` (aberta) corresponde ao Mini HAS
`0` (aberta), e Alexa `0` (fechada) corresponde ao Mini HAS `100` (fechada).

Por segurança, impressoras, câmeras, alarmes, alimentadores e dispositivos com
nomes/categorias de risco não são expostos. Um dispositivo suportado que foi
bloqueado pelo nome (por exemplo, um switch chamado `Churrasqueira`) só pode ser
liberado explicitamente pelo ID:

```text
ALEXA_ALLOWED_DEVICE_IDS=1,5
```

O opt-in não transforma tipos sem controlador Alexa seguro em dispositivos
controláveis. Cenas que atinjam qualquer dispositivo de risco são sempre
bloqueadas, mesmo que o dispositivo tenha opt-in para controle direto.

## Ativação

Importe `AlexaModule` no `AppModule`. O endpoint será:

```text
POST /alexa/smarthome
```

O endpoint exige o mesmo OAuth Bearer no header HTTP e no directive Alexa. A
validação usa `AuthService.validateAccessToken` por meio do token de injeção
`ALEXA_BEARER_VERIFIER`.

Variáveis:

```text
ALEXA_OAUTH_AUDIENCE=mini-has
ALEXA_MAX_ENDPOINTS=300
ALEXA_ALLOWED_DEVICE_IDS=
```

O cliente OAuth usado no account linking precisa permitir:

```text
devices:read devices:control scenes:read scenes:run
```

Configure esse cliente em `MINI_HAS_OAUTH_CLIENTS_JSON`, usando como
`redirectUris` as URLs fornecidas pelo console Alexa. Não coloque o endpoint
Alexa atrás de um login interativo do Cloudflare Access; ele já é protegido
pelo access token OAuth.
