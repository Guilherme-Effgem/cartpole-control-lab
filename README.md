# CartPole Control Lab

Bancada de simulação para comparar estratégias de controle do pêndulo invertido sobre carrinho (CartPole). Dois painéis rodam lado a lado com a mesma condição inicial; em cada um você escolhe **Fuzzy**, **PID** ou **Manual** (você mesmo tenta equilibrar), aplica perturbações e acompanha o ângulo em tempo real.

A física é a do `CartPoleEnv` do [Gymnasium](https://gymnasium.farama.org/environments/classic_control/cart_pole/), com força externa para perturbações e sem fim de episódio: a simulação roda até você pausar.

## Como rodar

### Opção 1: executável para Windows (não precisa instalar nada)

1. Baixe o `CartPoleControlLab.exe` na página de **Releases** deste repositório.
2. Dê dois cliques nele. Uma janela preta aparece e, em cerca de 5 s, o navegador abre a simulação (se não abrir, acesse `http://127.0.0.1:8765`).
3. Deixe a janela preta aberta enquanto usa. Fechá-la encerra o programa.

Requisitos: Windows 10/11 64 bits e um navegador. O Windows pode mostrar o aviso do SmartScreen porque o executável não é assinado: clique em "Mais informações" e "Executar assim mesmo".

### Opção 2: pelo código-fonte (Windows, macOS ou Linux)

Requer Python 3.10 ou superior.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.app:app
```

Abra `http://127.0.0.1:8000`. Com [`uv`](https://docs.astral.sh/uv/): `uv venv .venv --python 3.12`, `uv pip install -r requirements.txt` e o mesmo `uvicorn`.

## Como usar

| O quê | Onde / como |
|---|---|
| Iniciar, pausar, reiniciar | Barra de cima. Reiniciar volta os dois painéis à mesma condição inicial (seed 42). |
| Escolher o controlador | Seletor no topo de cada painel: Fuzzy, PID ou Manual. Os parâmetros aparecem logo abaixo e valem na hora. |
| Perturbar | Setas **←** / **→** do teclado ou botões ◀ ▶ na barra de cima. Tipo, intensidade e alvo no painel "Perturbações". |
| Controle manual | Painel A: teclas **A** / **D**. Painel B: **J** / **L**. Ou segure os botões na tela. Com só um painel em manual, os dois pares servem. |
| Editar regras Fuzzy | Botão "Editar regras Fuzzy (5×5)" no painel em modo Fuzzy. Abre uma janela lateral; a simulação continua rodando. `Esc` fecha. |
| Parâmetros físicos | Painel "Modelo mecânico": massas, comprimento do pêndulo, força do atuador, gravidade e comprimento da pista. Clique em "Aplicar"; vale sem reiniciar. |
| Queda / fim da pista | O painel mostra CAIU ou SAIU DA PISTA e o outro continua. Use "Reerguer" ou ligue "Reerguer automaticamente". |
| Velocidade | 1× (tempo real) a 10×. |

### Perturbações

- **Carrinho, força externa:** força em N aplicada por um tempo (padrão 20 N por 0,1 s).
- **Pêndulo, golpe na haste:** variação instantânea da velocidade angular, em rad/s.
- Podem ir nos dois painéis ou em um só. Há também o modo automático, que perturba a cada N segundos com sentido sorteado.
- Cada perturbação aparece como linha vermelha no gráfico.

Com o atuador padrão de 10 N, os controladores padrão aguentam cerca de 20 N × 0,1 s no carrinho e golpes de até ~3 rad/s. Acima disso caem, o que é coerente com a física.

## Controladores

Os dois controladores automáticos aplicam ±força do atuador (bang-bang, como no CartPole-v1). O manual também permite força zero.

**PID + PD de posição**

```
u = Kp·θ + Ki·∫θ + Kd·θ̇   +   Kx·x + Kv·ẋ
    └─── PID do ângulo ──┘     └ PD da posição ┘
```

O PID mantém o pêndulo em pé; o PD da posição (Kx, Kv) puxa o carrinho de volta ao centro da pista. Sem ele o carrinho deriva até o batente. Padrão: Kp 80, Ki 0, Kd 18, Kx 6, Kv 10.

**Fuzzy (Sugeno de ordem zero)**

- Entradas: ângulo θ e velocidade angular θ̇, com cinco conjuntos cada (NG, NP, Z, PP, PG).
- Saída: tabela de 25 regras com valores de −1 a +1 (positivo empurra para a direita).
- O ângulo que entra nas regras é `θ + peso_x·x + peso_v·ẋ` (padrão 0,08 e 0,02), pelo mesmo motivo do PD de posição.
- O limiar de decisão define a partir de que saída o carrinho é empurrado para a direita.

Os padrões foram sintonizados por simulação (12 condições iniciais, 60 s, empurrões de 20 N a cada 3 s, pista de 4,8 m): o PID não falhou em nenhuma; o Fuzzy falhou em uma.

## Métricas

Por painel, desde o último reinício: tempo, quedas, saídas de pista, RMS e máximo do ângulo, percentual do tempo dentro de ±12° (limite clássico do CartPole-v1) e posição atual e máxima do carrinho.

## Gerar o executável

Em Windows 10/11 64 bits: `build_windows.bat` (precisa do Python 3.12 com o launcher `py`), ou os comandos com `uv` em [`INSTRUCOES_DISTRIBUICAO.md`](INSTRUCOES_DISTRIBUICAO.md). O resultado é um único arquivo, `dist\CartPoleControlLab.exe`.

## Estrutura

```text
backend/app.py            física, controladores e servidor (FastAPI + websocket /ws)
frontend/                 interface (HTML, CSS e JavaScript puros)
launcher.py               ponto de entrada do executável: sobe o servidor e abre o navegador
CartPoleControlLab.spec   configuração do PyInstaller
build_windows.bat         build do executável
```

O protocolo do websocket e o histórico de mudanças estão em [`CHANGELOG.md`](CHANGELOG.md).
