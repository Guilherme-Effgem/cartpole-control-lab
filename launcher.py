from __future__ import annotations

import socket
import threading
import time
import webbrowser

HOST = "127.0.0.1"
FIRST_PORT = 8765
LAST_PORT = 8785


def find_port() -> int:
    for port in range(FIRST_PORT, LAST_PORT + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((HOST, port))
                return port
            except OSError:
                continue
    raise RuntimeError(
        f"Não foi possível encontrar uma porta livre entre {FIRST_PORT} e {LAST_PORT}. "
        "Feche outra instância do CartPole Control Lab e tente novamente."
    )


def main() -> None:
    print("CartPole Control Lab: iniciando, aguarde alguns segundos...", flush=True)
    # Imports pesados só depois da mensagem, para a janela não ficar vazia.
    import uvicorn
    from backend.app import app

    port = find_port()
    config = uvicorn.Config(app, host=HOST, port=port, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="cartpole-server", daemon=True)
    thread.start()

    url = f"http://{HOST}:{port}"
    deadline = time.time() + 30
    while time.time() < deadline and thread.is_alive():
        try:
            with socket.create_connection((HOST, port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.25)
    else:
        raise RuntimeError("O servidor local não iniciou. Verifique se o aplicativo foi extraído corretamente.")

    print("=" * 58)
    print("  CARTPOLE CONTROL LAB")
    print("  Simulação local: Fuzzy, PID e controle manual")
    print("=" * 58)
    print(f"Endereço: {url}")
    print("Mantenha esta janela aberta enquanto utilizar a simulação.")
    print("Para encerrar, feche esta janela ou pressione Ctrl+C.")
    webbrowser.open(url)

    try:
        while thread.is_alive():
            thread.join(timeout=1)
    except KeyboardInterrupt:
        print("\nEncerrando o CartPole Control Lab...")
        server.should_exit = True
        thread.join(timeout=5)


def run_with_visible_errors() -> None:
    """Se algo falhar, mostra o erro e espera Enter (senão a janela fecha sem explicar nada)."""
    try:
        main()
    except Exception:
        import traceback

        print("\n" + "=" * 58)
        print("  ERRO AO INICIAR O CARTPOLE CONTROL LAB")
        print("=" * 58)
        traceback.print_exc()
        print("\nTire um print desta janela e envie para quem passou o programa.")
        try:
            input("Pressione Enter para fechar...")
        except EOFError:
            pass
        raise SystemExit(1)


if __name__ == "__main__":
    run_with_visible_errors()
