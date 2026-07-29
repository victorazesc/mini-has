# Mini HAS Alexa Lambda

Proxy sem dependências entre a Alexa Smart Home Skill e o endpoint HTTPS do
Mini HAS.

## Lambda

- Runtime: Node.js 20 ou superior
- Handler: `index.handler`
- Arquivo: `index.js`
- Timeout recomendado: 8 segundos

Variáveis:

```text
MINI_HAS_ALEXA_ENDPOINT=https://mini-has.seudominio.com/alexa/smarthome
MINI_HAS_ALEXA_TIMEOUT_MS=6500
```

O código extrai o token OAuth do directive Alexa e o encaminha como
`Authorization: Bearer`. Não configure tokens estáticos na Lambda.

Restrinja o trigger da Lambda ao ID da sua Skill no console AWS. O hostname
deve usar HTTPS pelo Cloudflare Tunnel e não deve exigir uma tela interativa
do Cloudflare Access no caminho `/alexa/smarthome`.

## Teste

```bash
node --test index.test.js
```
