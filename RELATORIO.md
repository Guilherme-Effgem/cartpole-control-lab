# Relatório N2-1: CartPole Control Lab

Ambiente escolhido: **CartPole** do [Gymnasium](https://gymnasium.farama.org/environments/classic_control/cart_pole/) (controle clássico), o pêndulo invertido sobre um carrinho.

## 1. Por que o grupo escolheu esse ambiente?

É o problema clássico de controle de um sistema **instável e não linear**. A física é conhecida (equações de movimento do próprio Gymnasium), roda em qualquer notebook e permite comparar controladores lado a lado nas mesmas condições. Também é a base de sistemas instáveis reais, como Segway, foguete na decolagem e equilíbrio de robôs.

## 2. O que é medido (sensor) e o que é comandado (atuador)?

| | Variável |
|---|---|
| **Sensores** | Ângulo da haste (θ), velocidade angular (θ̇), posição do carrinho (x) e velocidade do carrinho (ẋ) |
| **Atuador** | Força horizontal aplicada no carrinho, limitada a ±10 N (configurável) |
| **Restrições** | Pista de comprimento fixo (4,8 m): o carrinho não pode bater nos batentes; a haste não pode cair (\|θ\| = 90°) |
| **Perturbações** | Empurrão no carrinho (força × duração) e golpe na haste (variação de velocidade angular), manuais ou automáticos |

## 3. Como pretendem modelar, controlar e comparar?

**Modelagem:** equações não lineares do Gymnasium, integradas por Euler a 50 Hz (Δt = 0,02 s). Parâmetros físicos ajustáveis ao vivo: massas, comprimento da haste, força do atuador e gravidade.

**Controladores** (cada painel pode usar qualquer um):

- **PID** no ângulo, somado a um PD na posição do carrinho (Kx·x + Kv·ẋ) para mantê-lo dentro da pista.
- **Fuzzy Sugeno** com base de 25 regras (5×5), editáveis na tela.
- **Manual:** um humano controla pelo teclado, como referência.

**Comparação:** dois painéis lado a lado, sob a mesma perturbação, com as métricas:

- tempo em pé e tempo dentro da faixa de ±12°;
- erro RMS do ângulo e ângulo máximo;
- número de quedas e de saídas da pista;
- deslocamento máximo do carrinho.

**Próximos passos (até o fim da disciplina):** controlador por **rede neural**, treinado com os dados dos controladores atuais, comparado nas mesmas métricas.

## Como executar

Instruções de uso no [README](README.md). Executável para Windows na página de [Releases](https://github.com/Guilherme-Effgem/cartpole-control-lab/releases).
