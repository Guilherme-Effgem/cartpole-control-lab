# CartPole Control Lab: distribuição para Windows

O build gera **um único arquivo**, `dist\CartPoleControlLab.exe` (~27 MB), com Python, bibliotecas e interface dentro. Quem recebe não instala nada.

## Para quem vai utilizar

1. Copie `CartPoleControlLab.exe` para qualquer pasta (se veio num ZIP, pode extrair ou abrir direto).
2. Dê dois cliques em `CartPoleControlLab.exe`.
3. Abre-se um terminal com "iniciando, aguarde alguns segundos..."; ele sobe o servidor local (uvicorn em `127.0.0.1:8765`) e, em cerca de 5 s, abre a interface no navegador padrão. Se não abrir, acesse `http://127.0.0.1:8765`.
4. Mantenha o terminal aberto durante o uso: ele hospeda o servidor, e fechá-lo encerra a aplicação.
5. Se der erro na inicialização, o terminal fica aberto exibindo o traceback. Tire um print e envie para quem passou o programa.

Requisitos: Windows 10/11 de 64 bits e um navegador. Não precisa de internet.

O executável não tem assinatura digital, então o Windows pode mostrar o aviso azul do SmartScreen ("O Windows protegeu o computador"). Se o arquivo veio de fonte confiável, clique em "Mais informações" e depois em "Executar assim mesmo".

## Para quem vai gerar o executável

Precisa ser feito em Windows 10/11 64 bits, com internet na primeira vez.

### Opção 1: com o Python Launcher (`py`)

Instale **Python 3.12 x64** (https://www.python.org/downloads/windows/, marcando o Python Launcher) e dê dois cliques em `build_windows.bat`.

### Opção 2: com o `uv` (sem `py`)

Na pasta do projeto:

```powershell
uv venv .build-venv --python 3.12
uv pip install --python .build-venv\Scripts\python.exe -r requirements.txt pyinstaller==6.16.0
.build-venv\Scripts\python.exe -m PyInstaller --noconfirm --clean CartPoleControlLab.spec
```

Saída: `dist\CartPoleControlLab.exe`.

## Observações técnicas

- O `.exe` se descompacta numa pasta temporária a cada execução; por isso leva alguns segundos para abrir. O pacote foi enxugado (174 arquivos) para isso ser rápido: o `pygame` e os outros ambientes do Gymnasium ficam de fora, já que o desenho é feito no navegador e só o CartPole é usado.
- O servidor escuta apenas em `127.0.0.1`: não fica exposto à rede.
- Se a porta 8765 estiver ocupada, o aplicativo tenta as seguintes até 8785.
- Até a primeira versão do build da 0.3.3, o resultado era uma pasta com o `.exe` e uma subpasta `_internal`. Abrir o `.exe` sem essa subpasta (por exemplo, direto do ZIP) fazia a janela abrir e fechar sem mensagem. O formato de arquivo único resolve isso.
