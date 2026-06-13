# Mini-HAS: brainstorm de features

## Visao do produto

O Mini-HAS ja tem uma boa base para ser um hub residencial local-first:

- integra provedores cloud e dispositivos locais;
- descobre, revisa e aceita novos dispositivos;
- organiza dispositivos por piso e ambiente;
- controla dispositivos pela lista, detalhe e planta 3D;
- executa cenas e automacoes orientadas a eventos;
- registra historico de comandos, estados e falhas.

A melhor evolucao nao parece ser adicionar mais telas isoladas, mas fechar o ciclo:

**observar a casa -> entender o que importa -> agir automaticamente -> avisar o morador -> explicar o que aconteceu.**

## Lacunas observadas

- O card de energia e o contador de alertas do dashboard ainda sao simulados.
- Automacoes aceitam apenas um gatilho por mudanca de estado e sempre executam uma cena.
- Nao existem condicoes, horarios, atraso, cooldown ou modos da casa.
- Historicos existem por dispositivo, mas nao ha uma central da casa.
- Configuracoes e ajuda ainda nao possuem fluxos reais.
- Camera e alguns providers aparecem como planejados ou parcialmente implementados.
- Nao ha backup/restauracao, usuarios ou controle de acesso visivel.

## Priorizacao sugerida

| Prioridade | Feature | Valor | Esforco |
|---|---|---:|---:|
| P0 | Central de alertas e saude | Alto | Medio |
| P0 | Automacoes 2.0 | Muito alto | Alto |
| P0 | Backup e restauracao | Alto | Baixo |
| P1 | Dashboard de energia real | Alto | Medio |
| P1 | Modos da casa | Alto | Medio |
| P1 | Atualizacao em tempo real da UI | Alto | Medio |
| P1 | Notificacoes externas | Alto | Medio |
| P2 | Cameras ONVIF/RTSP | Medio | Alto |
| P2 | Sugestoes inteligentes de automacao | Medio | Alto |
| P2 | Usuarios, perfis e acesso remoto | Alto | Muito alto |

## P0: confiabilidade e automacao

### 1. Central de alertas e saude

Transformar os eventos que ja existem em uma tela acionavel.

Possibilidades:

- dispositivos offline, bateria baixa e falha de comando;
- integracoes desconectadas ou com sincronizacao falhando;
- alertas de seguranca, sensor aberto e automacao com erro;
- severidade, leitura/arquivamento e filtro por ambiente;
- contador real no dashboard 3D;
- acao direta: consultar device, repetir comando ou abrir integracao.

**MVP:** listar eventos importantes existentes e substituir o contador fixo do dashboard.

### 2. Automacoes 2.0

Evoluir o motor atual para expressar regras reais da casa.

Possibilidades:

- condicoes: igual, diferente, maior/menor, online/offline;
- gatilhos por horario, nascer/por do sol e webhook;
- multiplos gatilhos e multiplas condicoes;
- atraso entre acoes e espera por estado;
- cooldown para impedir execucoes repetidas;
- janela de horario e dias da semana;
- botao "testar automacao";
- simulacao explicando por que executaria ou nao;
- historico com gatilho, condicoes avaliadas e resultado.

**Exemplo:** se a porta abrir depois das 19h e a casa estiver em modo "Ausente", acender a entrada, disparar alarme e enviar notificacao.

### 3. Backup e restauracao

Proteger a configuracao da casa antes de aumentar a complexidade.

Possibilidades:

- exportar SQLite, configuracoes e modelos 3D;
- restaurar backup com validacao;
- backup automatico agendado;
- mostrar data e resultado do ultimo backup;
- opcao de exportar sem segredos.

**MVP:** download e restauracao manual de um pacote versionado.

## P1: experiencia diaria

### 4. Dashboard de energia real

Substituir o card simulado por dados de medidores e dispositivos compativeis.

Possibilidades:

- consumo atual, diario e mensal;
- geracao solar, consumo e saldo da rede;
- custo estimado por tarifa;
- ranking por dispositivo e ambiente;
- deteccao de consumo anormal;
- automacao baseada em potencia ou custo.

**MVP:** registrar leituras de potencia/energia e exibir total diario com historico.

### 5. Modos da casa

Criar estados globais que simplificam cenas e automacoes.

Modos iniciais:

- Casa;
- Ausente;
- Dormindo;
- Ferias;
- Visita.

Cada modo pode ativar cenas, ajustar seguranca e servir como condicao de automacao.

### 6. Atualizacao em tempo real

Refletir eventos e estados na UI sem depender de recarregar ou consultar manualmente.

Possibilidades:

- SSE ou WebSocket entre servidor e client;
- atualizacao instantanea do dashboard 3D;
- feedback visual durante comandos;
- indicador de estado desatualizado;
- reconciliacao automatica com estado MQTT retained.

### 7. Notificacoes externas

Levar alertas importantes para fora do dashboard.

Canais possiveis:

- notificacao web push;
- Telegram;
- e-mail;
- webhook generico.

Controles necessarios:

- severidade minima;
- horario silencioso;
- agrupamento e cooldown;
- teste do canal.

## P2: expansao

### 8. Cameras ONVIF/RTSP

- cadastro e descoberta assistida;
- snapshot e visualizacao ao vivo;
- camera vinculada a ambiente e planta 3D;
- captura ao ocorrer alerta;
- presets e controle PTZ quando suportado.

Comecar por snapshot reduz bastante o risco comparado a streaming completo.

### 9. Sugestoes inteligentes de automacao

Usar o historico local para sugerir, sem executar automaticamente:

- "Esta luz costuma ser desligada as 23h";
- "A persiana fecha quando a temperatura passa de X";
- "Este device ficou offline tres vezes nesta semana";
- deteccao de cenas e automacoes redundantes.

Toda sugestao deve mostrar a evidencia e exigir confirmacao.

### 10. Usuarios, perfis e acesso remoto

- administrador, morador e visitante;
- permissoes por ambiente ou dispositivo;
- log de auditoria por usuario;
- acesso temporario;
- acesso remoto seguro.

Esta feature exige uma decisao de produto e arquitetura de seguranca antes da implementacao.

## Quick wins

1. Tornar o contador de alertas real usando eventos importantes ja registrados.
2. Criar pagina "Saude da casa" com dispositivos offline e integracoes com erro.
3. Implementar exportacao manual de backup.
4. Adicionar condicao simples de estado nas automacoes.
5. Adicionar gatilho por horario.
6. Trocar o card de energia simulado por estado vazio explicando como habilitar.
7. Criar pagina de configuracoes com status do servidor, MQTT, storage e versao.

## Roadmap sugerido

### Fase 1: casa confiavel

- central de alertas;
- saude da casa;
- backup/restauracao;
- configuracoes operacionais.

### Fase 2: casa automatizada

- condicoes e horarios;
- cooldown, atrasos e teste de automacao;
- modos da casa;
- notificacoes externas.

### Fase 3: casa observavel

- eventos em tempo real;
- energia real;
- timeline global;
- metricas e tendencias.

### Fase 4: expansao

- cameras;
- sugestoes inteligentes;
- usuarios e acesso remoto.

## Banco de ideias adicionais

Ideias interessantes para explorar depois, sem compromisso de roadmap:

- painel PWA para celular, tablet de parede e modo kiosk;
- presenca por pessoa e por ambiente usando Wi-Fi, BLE ou sensores;
- geofencing para ativar modos Casa/Ausente;
- mapa 3D com calor, umidade, luminosidade e dispositivos offline;
- manutencao preventiva e previsao de troca de bateria;
- ponte com Home Assistant, MQTT Discovery, Matter ou assistentes de voz;
- comandos em linguagem natural com confirmacao antes de acoes sensiveis;
- acesso temporario por QR code para visitantes ou prestadores;
- comparacao de conforto e consumo entre ambientes;
- simulador de automacoes usando eventos historicos.

## Criterio para escolher a proxima feature

Priorizar features que:

1. resolvam um problema recorrente real da casa;
2. reaproveitem eventos, estados e comandos ja existentes;
3. funcionem localmente mesmo sem internet;
4. sejam explicaveis e reversiveis;
5. reduzam a necessidade de abrir varias telas para entender uma falha.

## Recomendacao

Comecar por **Central de alertas e saude**.

Ela aproveita dados ja existentes, remove elementos simulados do dashboard e cria a base para notificacoes, energia, cameras e automacoes mais confiaveis.
