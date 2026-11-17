# Histórico de mudanças

## 0.3.3

- Perturbação pelas setas ← / → e botões ◀ ▶ na barra de cima. Manual do painel B passou para J / L.
- Regras Fuzzy numa janela lateral não modal, aberta por botão.
- Ganhos separados em "PID do ângulo" e "PD da posição do carrinho".
- Executável em arquivo único (~27 MB, abre em ~5 s). Se der erro ao iniciar, a janela mostra a mensagem em vez de fechar.

## 0.3.2

- Pista de tamanho fixo (padrão 4,8 m) com batentes; encostar no batente é falha ("SAIU DA PISTA").
- Realimentação de posição nos controladores: PID + Kx·x + Kv·ẋ; Fuzzy com θ + peso_x·x + peso_v·ẋ.

## 0.3.1

- "Restaurar padrão" nos ganhos do PID.
- Editor da tabela de regras Fuzzy 5×5 por painel, com regras ativas destacadas em tempo real.

## 0.3.0

- Painéis configuráveis (Fuzzy, PID ou Manual).
- Perturbações manuais e automáticas (força no carrinho ou golpe no pêndulo).
- Simulação contínua, sem limite de 500 passos; quedas, "Reerguer" e reerguer automático.
- Parâmetros físicos aplicados em tempo real; força do atuador e gravidade configuráveis.
- Correções: sliders do modelo mecânico voltavam ao valor anterior antes de aplicar; limiar Fuzzy zerava a cada reinício; gráfico avançava pausado.

## 0.2.x

- Primeira versão: Fuzzy x PID em duas instâncias do CartPole-v1, geometria e massas configuráveis.

## Protocolo do websocket (`/ws`)

Mensagens JSON com a chave `command`:

| Comando | Campos |
|---|---|
| `start`, `pause` | — |
| `reset` | `seed` |
| `speed` | `value` (1 a 10) |
| `controller` | `panel` (a/b), `type` (fuzzy/pid/manual), `params`: kp, ki, kd, kx, kv, threshold, fx, fv, rules (5×5) |
| `manual` | `panel`, `direction` (−1, 0, 1) |
| `physical_config` | `values`: cart_mass, pole_mass, pole_length, force_mag, gravity, track_length, cart_width, cart_height, pole_thickness |
| `disturb` | `target` (cart/pole), `direction`, `magnitude`, `duration`, `panels` (all/a/b) |
| `auto_disturb` | `enabled`, `interval`, `target`, `magnitude`, `duration` |
| `auto_rise` | `enabled` |
| `rise` | `panel` |

O servidor envia um snapshot de estado a cada 20 ms (`type: "state"`).
