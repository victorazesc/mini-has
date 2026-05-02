# Mini-HAS Server API

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

## Entities

Entities são os pontos controláveis:

- `switch`
- `light`
- `cover`
- `sensor`
- `camera`
- `climate`

### Listar

```http
GET /entities
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
