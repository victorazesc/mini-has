# Mini-HAS Matter Bridge

Plugin local do Matterbridge que expõe entidades seguras do Mini-HAS para Alexa e outros controladores Matter.

## Escopo inicial

- Luzes e relés identificados como iluminação.
- Tomadas e switches.
- Persianas com abrir, fechar, parar e posição.
- Sensores de abertura das portas e janelas.
- Ar-condicionado com energia e ajuste de 16 a 30 °C.
- Um endpoint por entidade, inclusive dispositivos multicanal.
- IDs estáveis independentes de IP.
- A entidade `1` (Churrasqueira) é exposta como luz.
- Tipos sem categoria Alexa/Matter aparecem como sensores de status somente leitura.

## Contrato

O plugin acessa somente `http://127.0.0.1:8000`:

- `GET /devices`
- `GET /entities`
- `POST /devices/:id/command`

Não lê banco nem credenciais de provedores. Matter e Mini-HAS usam `0 = aberta` e `100 = fechada`.

## Teste

```bash
npm test
```

O Matterbridge deve carregar o plugin a partir do pacote instalado, sem uma segunda cópia de `matterbridge` nas dependências.
