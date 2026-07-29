# Mini-HAS

Central de automação residencial local com painel web, descoberta de
dispositivos, MQTT, autenticação, OAuth, MCP e integração Matter/Alexa.

## Recursos

- Dispositivos Wi-Fi, MQTT, Tuya LAN, SmartThings, ONVIF e Intelbras.
- Descoberta de IP por MAC na rede local.
- Ambientes, entidades multicanal, cenas e automações.
- Persiana com posição, encoder e calibração guiada segura.
- Login por e-mail/senha e sessões HTTP.
- OAuth 2.0 para MCP e integrações externas.
- Endpoint MCP com leitura e controle limitados por escopo.
- Bridge Matter local para luzes, tomadas, persianas, sensores e ar-condicionado.
- Cloudflare Tunnel opcional para HTTPS externo.
- Banco SQLite local com backup antes de deploy.

## Estrutura

```text
client/                         Next.js
server/                         NestJS + SQLite
integrations/matterbridge-mini-has/
integrations/alexa-lambda/
config/                         exemplos de configuração
deploy/printer/                 instalação nativa no Raspberry
```

## Docker

Execução padrão:

```bash
docker compose -f docker-compose.prod.yml up -d --build --force-recreate
```

Para habilitar descoberta por MAC usando a rede do host:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.lan.yml \
  up -d --build --force-recreate
```

Os modelos 3D enviados pelo painel ficam no volume `client_floor_models`. Não
use `docker compose down -v` em redeploys se quiser preservar uploads e dados.

## Raspberry da impressora

No Raspberry que também executa Klipper/Mainsail, o modo recomendado é nativo:

```bash
cp config/printer.env.example config/printer.env
# edite config/printer.env antes de continuar
sudo ./deploy/printer/install-native.sh
```

O instalador:

- cancela se a impressora estiver imprimindo ou pausada;
- valida Klipper/Moonraker antes e depois;
- cria backup e verifica a integridade do SQLite;
- compila backend e frontend com limites de CPU, memória e I/O;
- troca a release de forma atômica e faz rollback em caso de falha;
- mantém somente as duas releases mais recentes;
- não reinicia Klipper;
- preserva Mainsail em `printer.local`.

Serviços principais:

```text
mini-has-server.service
mini-has-client.service
mini-has-cloudflared.service
mini-has-mdns-alias.service
mini-has-matterbridge.service
mosquitto.service
```

O painel fica em `http://<IP_DO_SERVIDOR>:3000` e, quando o alias mDNS está
ativo, em `http://casa.local`. O backend permanece restrito a
`127.0.0.1:8000`.

## Configuração e segredos

Use [config/printer.env.example](config/printer.env.example) como base.

Na primeira inicialização, defina:

```text
MINI_HAS_ADMIN_EMAIL
MINI_HAS_ADMIN_PASSWORD
```

A senha precisa ter pelo menos 12 caracteres. Arquivos `.env`, credenciais do
Cloudflare, banco SQLite e `config/printer.env` são ignorados pelo Git. Nunca
publique esses arquivos.

## Cloudflare Tunnel

Copie o exemplo correspondente:

```bash
cp config/cloudflared/config.native.yml.example \
  config/cloudflared/config.native.yml
```

Preencha o UUID do túnel, o hostname e coloque o JSON de credencial em
`config/cloudflared/`. Na instalação nativa, o serviço é habilitado
automaticamente quando existe exatamente uma credencial válida.

No modo Docker:

```bash
docker compose --env-file config/printer.env \
  -f docker-compose.printer.yml --profile tunnel up -d cloudflared
```

## MCP e OAuth

O servidor MCP usa OAuth e escopos explícitos:

```text
devices:read
devices:control
scenes:read
scenes:run
mcp:connect
```

Configure os clientes em `MINI_HAS_OAUTH_CLIENTS_JSON`. O endpoint público MCP
é `/mcp`; os metadados de autorização ficam em `/.well-known/`.

## Matter e Alexa

O plugin local está em
[integrations/matterbridge-mini-has](integrations/matterbridge-mini-has).
Ele expõe somente representações Matter seguras e usa a API local do Mini-HAS,
sem ler o banco ou credenciais dos provedores.

Teste do plugin:

```bash
cd integrations/matterbridge-mini-has
npm test
```

Também existe um adaptador Alexa Smart Home opcional em
`integrations/alexa-lambda`. Para uma instalação sem AWS, use o Matterbridge.

## Calibração da persiana

Quando a posição estiver desconhecida, Abrir/Fechar e o slider ficam bloqueados.
Na tela da persiana:

1. Clique em **Iniciar calibração**.
2. Use jog até ficar totalmente aberta.
3. Clique em **Parar motor agora** e **Salvar aberto**.
4. Use jog até ficar totalmente fechada.
5. Clique em **Parar motor agora** e **Salvar fechado**.

O botão de STOP permanece disponível durante toda a calibração, inclusive se
uma confirmação MQTT atrasar. Não use `Zerar encoder` no fluxo normal.

## Desenvolvimento e testes

Backend:

```bash
cd server
npm ci
npm test
```

Frontend:

```bash
cd client
npm ci
npm run build
```

Antes de publicar no Raspberry, confirme que a impressora está parada. O
instalador faz a mesma verificação e aborta sem trocar a release se algo falhar.
