# Mini-HAS Server API

## Como rodar

```bash
npm install
npm run start:dev
```

Esta API separa a casa inteligente em quatro camadas:

1. **Discovery**: acha coisas na LAN.
2. **Integrations**: conecta provedores externos ou locais.
3. **Inbox**: fila visual de candidatos encontrados/importados.
4. **Devices/Entities**: dispositivos aceitos oficialmente na casa.

## Fluxo Visual Recomendado

```txt
Adicionar integracao
  -> escolher provider
  -> preencher credenciais/config
  -> testar
  -> sincronizar
  -> rodar discovery local
  -> revisar inbox
  -> aceitar/ignorar device
  -> escolher comodo
  -> controlar entities
```

## Providers

### Listar providers

```http
GET /integration-providers
```

Retorna providers disponiveis e campos esperados.

Tipos atuais:

- `tuya_cloud`
- `tuya_local`
- `smartthings_cloud`
- `intelbras_izy_tuya`
- `intelbras_amt8000`
- `intelbras_solar`
- `persiana_custom`
- `generic_iot`
- `esphome`
- `onvif_camera`
- `mqtt`

## Integrations

Integrações guardam credenciais/config de um provider.

Campos sensíveis, como `accessSecret`, `token` e `localKey`, ficam em storage separado e não voltam no `GET`.

### Criar Tuya Cloud

```http
POST /integrations
```

```json
{
  "type": "tuya_cloud",
  "name": "Tuya Casa",
  "config": {
    "accessId": "xxxxx",
    "accessSecret": "xxxxx",
    "region": "auto"
  },
  "testOnCreate": true
}
```

Por padrão `testOnCreate` é `true`: a API testa a credencial antes de salvar.

- sucesso: salva com status `connected`;
- falha: retorna `400` e não salva;
- `accessId` Tuya repetido: retorna `409`.

### Criar SmartThings

```json
{
  "type": "smartthings_cloud",
  "name": "SmartThings Casa",
  "config": {
    "token": "xxxxx"
  }
}
```

### Criar Persiana Custom

```json
{
  "type": "persiana_custom",
  "name": "Persiana Sala",
  "config": {
    "baseUrl": "http://192.168.1.137",
    "ip": "192.168.1.137",
    "deviceType": "cover"
  }
}
```

### Criar Intelbras Solar Send

Integra microinversores Intelbras via OpenAPI Solarman. A integracao e somente leitura.

```json
{
  "type": "intelbras_solar",
  "name": "Intelbras Solar Send",
  "config": {
    "appId": "xxxxx",
    "appSecret": "xxxxx",
    "email": "usuario@email.com",
    "password": "xxxxx",
    "moduleCount": 4
  }
}
```

### Criar integração de câmeras ONVIF/RTSP

Busca câmeras na rede local pelas portas RTSP `554` e `8554`. Usuário, senha e caminho RTSP são configurados individualmente no dispositivo após ele ser aceito.

```json
{
  "type": "onvif_camera",
  "name": "Cameras da rede",
  "config": {
    "subnetPrefix": "192.168.1"
  }
}
```

### Configurar uma câmera

```http
PATCH /devices/{id}
```

```json
{
  "cameraConfig": {
    "ip": "192.168.1.10",
    "port": 554,
    "username": "admin",
    "password": "xxxxx",
    "rtspPath": "/cam/realmonitor?channel=1&subtype=0"
  }
}
```

Carregar a configuração individual salva:

```http
GET /devices/{id}/configuration
```

Exibir o stream RTSP no navegador, convertido localmente para MJPEG:

```http
GET /devices/{id}/stream.mjpeg
```

O stream exige `ffmpeg` instalado no servidor. O binário pode ser definido por `FFMPEG_PATH`.

### Testar integração

```http
POST /integrations/{id}/test
```

Valida credenciais/conectividade quando o provider suporta teste.

### Sincronizar integração

```http
POST /integrations/{id}/sync
```

O sync importa devices do provider e joga tudo na inbox.
Além de `inboxIds`, a resposta também traz `inboxDevices`, pronta para a UI renderizar a tela de revisão sem precisar chamar `GET /inbox/devices`.

Exemplo Tuya:

- busca token;
- lista devices da conta;
- normaliza nome/modelo/categoria/status;
- salva `localKey` em segredo;
- cria candidates na inbox.

## Discovery

### Rodar scan LAN

```http
POST /discovery/scan
```

```json
{
  "subnet_prefix": "192.168.1",
  "probeMode": "aggressive"
}
```

O scan salva histórico em SQLite e também cria/atualiza candidatos `discovery` na inbox.

Header retornado:

```txt
X-Discovery-Scan-Id: 1
```

## Inbox

A inbox é o ponto principal da UI.

Ela contém:

- device vindo de cloud;
- device vindo da LAN;
- device local/custom;
- sugestões futuras de vínculo cloud/local.

### Listar candidatos

```http
GET /inbox/devices
GET /inbox/devices?status=pending
GET /inbox/devices?status=pending&provider=tuya_cloud
```

Status:

- `pending`
- `accepted`
- `ignored`

### Aceitar candidato

```http
POST /inbox/devices/{id}/accept
```

```json
{
  "name": "Luz da sala",
  "roomId": 1,
  "createEntities": true
}
```

Cria ou atualiza um device oficial e suas entities.

### Ignorar candidato

```http
POST /inbox/devices/{id}/ignore
```

```json
{
  "reason": "Nao quero controlar agora"
}
```

## Rooms

### Criar comodo

```http
POST /rooms
```

```json
{
  "name": "Sala",
  "description": "Sala principal"
}
```

### Listar comodos

```http
GET /rooms
```

## Devices

Devices são itens aceitos oficialmente na casa.

### Listar

```http
GET /devices
```

Retorna `roomId` e `roomName` quando o device estiver vinculado a um cômodo.

### Criar manual

```http
POST /devices
```

```json
{
  "externalId": "manual:persiana-sala",
  "name": "Persiana Sala",
  "deviceType": "cover",
  "provider": "manual",
  "roomId": 1,
  "localDeviceKey": "ip:192.168.1.137"
}
```

### Vincular device local

```http
POST /devices/{id}/link-local
```

```json
{
  "localDeviceKey": "mac:CC:7B:5C:4F:90:18",
  "payload": {
    "ip": "192.168.1.137",
    "source": "discovery"
  }
}
```

### Vincular local automaticamente

Usa os dispositivos salvos por discovery para preencher `payload.local` e `localDeviceKey`.
Também roda automaticamente quando um item da inbox é aceito.

```http
POST /devices/{id}/auto-link-local
POST /devices/auto-link-local
```

Para Tuya, quando não existe IP no cloud payload, a API tenta descobrir o IP local testando os candidatos da LAN com `deviceId + localKey + cid`.

### Enviar comando

```http
POST /devices/{id}/command
```

Switch Tuya:

```json
{
  "command": "turn_on",
  "params": {}
}
```

Por padrão, devices Tuya usam execução local LAN quando houver `ip` e `localKey`.

Comando Tuya bruto:

```json
{
  "command": "set",
  "params": {
    "dpsId": "1",
    "value": true
  }
}
```

Consultar status local:

```json
{
  "command": "query",
  "params": {}
}
```

Forçar cloud Tuya, somente se quiser fallback remoto:

```json
{
  "command": "turn_on",
  "params": {
    "transport": "cloud"
  }
}
```

HTTP local/custom:

```json
{
  "command": "open",
  "params": {
    "path": "/open"
  }
}
```

Executores atuais:

- `tuya_cloud` e `tuya_local`: tentam Tuya LAN local primeiro.
- `generic_iot` e `persiana_custom`: envia HTTP para `baseUrl`.
- demais providers: retornam `unsupported` até receberem executor dedicado.

Quando o comando ou `query` retorna `dps`, a API persiste o estado em `devices.status`,
`devices.capabilities.status` e nas `entities` do device. Depois disso, `GET /devices`
e `GET /entities` já retornam o último estado conhecido sem consultar o device de novo.

## Disponibilidade local

O servidor reconcilia automaticamente a disponibilidade local dos devices:

- probe de controle local a cada 60 segundos;
- discovery LAN leve a cada 5 minutos enquanto houver Tuya Cloud sem rota local, sem criar itens na inbox;
- vínculo Tuya por handshake autenticado usando `deviceId + localKey`, sem associação por chute;
- Tuya com rota local usa LAN por padrão e mantém fallback cloud;
- MQTT local, Intelbras AMT e HTTP local são marcados como disponíveis offline;
- providers sem protocolo LAN, como SmartThings, são marcados como somente cloud.

Intervalos configuráveis:

- `LOCAL_RECONCILE_INTERVAL_MS`
- `LOCAL_DISCOVERY_INTERVAL_MS`

Execução manual:

```http
POST /devices/reconcile-local
```

O resultado fica em `device.status.connectivity`, incluindo `controlMode`,
`offlineReady`, `localAvailable`, `checkedAt`, `transport` e `reason`.

## Entities

Entities são os pontos controláveis:

- `switch`
- `light`
- `cover`
- `sensor`
- `camera`
- `climate`

Um device físico multicanal continua sendo um único device. Cada canal controlável
é uma entity própria, podendo ter nome e posição espacial independentes.

### Listar

```http
GET /entities
```

### Renomear

```http
PATCH /entities/{id}
```

```json
{
  "name": "Luz da prateleira"
}
```

### Enviar comando

```http
POST /entities/{id}/command
```

```json
{
  "command": "set_position",
  "params": {
    "position": 45
  }
}
```

Esta rota continua disponível para logs/compatibilidade. Para controle real por provider, prefira `POST /devices/{id}/command`.

## Posições espaciais

```http
GET /floors/{id}/device-positions
PUT /floors/{id}/device-positions
```

Cada posição recebe `deviceId` e, para canais multicanal, pode receber também
`entityId`. Assim canais do mesmo device podem ser posicionados separadamente.

## Banco SQLite

Arquivo padrão:

```txt
data/mini-has.db
```

Tabelas principais:

- `integrations`
- `device_inbox`
- `devices`
- `entities`
- `rooms`
- `command_logs`
- `device_command_logs`
- `discovery_scans`
- `discovery_devices`

## Segurança

- `GET /integrations` nunca retorna secrets.
- Secrets ficam em colunas `secrets_json`.
- Antes de produção, trocar `secrets_json` por criptografia local ou keychain.

## Como Escalar

Novo provider deve implementar:

```txt
test_provider()
sync_provider()
normalizacao para ProviderDevice
normalizacao para ProviderEntity
executor de command, quando existir runtime
```

Regra:

- Cloud importa identidade e capabilities.
- LAN valida presença local e IP.
- Inbox decide o que entra na casa.
- Devices/entities representam apenas o que foi aceito.
