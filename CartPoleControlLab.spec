# PyInstaller build configuration. Run from the project root on Windows.
#
# Gera um único CartPoleControlLab.exe. Tudo (Python, bibliotecas e frontend)
# vai dentro dele e é extraído para uma pasta temporária a cada execução, então
# o .exe funciona sozinho, inclusive aberto de dentro do ZIP.
#
# O pacote é enxuto de propósito: quanto menos arquivos, mais rápido o .exe abre
# (o antivírus examina cada arquivo extraído). Por isso não usamos collect_all:
# os hooks padrão do PyInstaller já cuidam do numpy, e do Gymnasium só precisamos
# do CartPole. O pygame fica de fora: ele só serve para a janela de renderização
# do Gymnasium, e aqui o desenho é feito no navegador.
from PyInstaller.utils.hooks import collect_submodules, copy_metadata

datas = [("frontend", "frontend")]
for distribution in ["gymnasium", "numpy", "fastapi", "uvicorn", "websockets"]:
    try:
        datas += copy_metadata(distribution)
    except Exception:
        pass

hiddenimports = [
    "backend.app",
    "gymnasium.envs.classic_control.cartpole",
]
# uvicorn escolhe loop/protocolos por nome em tempo de execução.
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("websockets")

a = Analysis(
    ["launcher.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pygame", "tkinter", "matplotlib", "pytest", "IPython", "jax", "torch",
        "mujoco", "Box2D", "ale_py", "cv2", "moviepy", "PIL",
        "numpy.tests", "numpy.f2py", "numpy.distutils",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="CartPoleControlLab",
    console=True,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
)
