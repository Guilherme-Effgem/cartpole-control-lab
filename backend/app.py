from __future__ import annotations

import asyncio
import contextlib
import math
import random
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from gymnasium.envs.classic_control.cartpole import CartPoleEnv

VERSION = "0.3.3"
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="CartPole Control Lab", version=VERSION)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.middleware("http")
async def no_cache(request, call_next):
    # Evita que o navegador misture HTML novo com JS/CSS antigos depois de uma atualização.
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/")
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")


# ---------------------------------------------------------------------------
# Física
# ---------------------------------------------------------------------------

class LabCartPole(CartPoleEnv):
    """CartPole do Gymnasium com força contínua e perturbação externa.

    As equações e o integrador são os mesmos de CartPoleEnv.step (Florian,
    "Correct equations for the dynamics of the cart-pole system"). A diferença
    é que a força aplicada ao carro é a soma da força do controlador com uma
    força externa (perturbação), e que não há término do episódio: quem decide
    quando parar é o usuário.
    """

    def step_force(self, force: float) -> np.ndarray:
        x, x_dot, theta, theta_dot = self.state
        costheta = math.cos(theta)
        sintheta = math.sin(theta)
        temp = (force + self.polemass_length * theta_dot**2 * sintheta) / self.total_mass
        thetaacc = (self.gravity * sintheta - costheta * temp) / (
            self.length * (4.0 / 3.0 - self.masspole * costheta**2 / self.total_mass)
        )
        xacc = temp - self.polemass_length * thetaacc * costheta / self.total_mass

        if self.kinematics_integrator == "euler":
            x = x + self.tau * x_dot
            x_dot = x_dot + self.tau * xacc
            theta = theta + self.tau * theta_dot
            theta_dot = theta_dot + self.tau * thetaacc
        else:
            x_dot = x_dot + self.tau * xacc
            x = x + self.tau * x_dot
            theta_dot = theta_dot + self.tau * thetaacc
            theta = theta + self.tau * theta_dot

        self.state = np.array((x, x_dot, theta, theta_dot), dtype=np.float64)
        return self.state

    def apply_physics(self, config: dict[str, float]):
        self.masscart = float(config["cart_mass"])
        self.masspole = float(config["pole_mass"])
        self.total_mass = self.masscart + self.masspole
        self.length = float(config["pole_length"]) / 2.0  # Gymnasium usa meio comprimento
        self.polemass_length = self.masspole * self.length
        self.force_mag = float(config["force_mag"])
        self.gravity = float(config["gravity"])


# ---------------------------------------------------------------------------
# Controladores
# ---------------------------------------------------------------------------

def trimf(x: float, a: float, b: float, c: float) -> float:
    if x <= a or x >= c:
        return 0.0
    if x == b:
        return 1.0
    if x < b:
        return (x - a) / (b - a)
    return (c - x) / (c - b)


def trapmf(x: float, a: float, b: float, c: float, d: float) -> float:
    if x < a or x > d:
        return 0.0
    if b <= x <= c:
        return 1.0
    if x < b:
        return (x - a) / (b - a) if b != a else 1.0
    return (d - x) / (d - c) if d != c else 1.0


def fuzzy_sets_angle(theta: float) -> list[float]:
    x = float(np.clip(theta, -0.2094, 0.2094))
    return [
        trapmf(x, -0.30, -0.2094, -0.1571, -0.0785),
        trimf(x, -0.1571, -0.0785, 0.0),
        trimf(x, -0.0785, 0.0, 0.0785),
        trimf(x, 0.0, 0.0785, 0.1571),
        trapmf(x, 0.0785, 0.1571, 0.2094, 0.30),
    ]


def fuzzy_sets_rate(theta_dot: float) -> list[float]:
    x = float(np.clip(theta_dot, -3.0, 3.0))
    return [
        trapmf(x, -5.0, -3.0, -2.25, -1.125),
        trimf(x, -2.25, -1.125, 0.0),
        trimf(x, -1.125, 0.0, 1.125),
        trimf(x, 0.0, 1.125, 2.25),
        trapmf(x, 1.125, 2.25, 3.0, 5.0),
    ]


class FuzzyController:
    """Controlador Sugeno de ordem zero, com regras e pertinências implementadas manualmente."""

    RULES = np.array([
        [-1.00, -1.00, -0.85, -0.60, -0.25],
        [-1.00, -0.80, -0.55, -0.20,  0.20],
        [-0.85, -0.55,  0.00,  0.55,  0.85],
        [-0.20,  0.20,  0.55,  0.80,  1.00],
        [ 0.25,  0.60,  0.85,  1.00,  1.00],
    ])

    def __init__(self, threshold: float = 0.0, kx: float = 0.08, kv: float = 0.02):
        self.threshold = threshold
        # Pesos de posição: o ângulo que entra no fuzzy é θ + kx·x + kv·ẋ.
        # Com kx, kv > 0 o controlador "inclina" o pêndulo para o centro da pista.
        self.kx, self.kv = kx, kv
        self.rules = self.RULES.copy()
        self.activations = np.zeros((5, 5))

    def reset(self):
        self.activations = np.zeros((5, 5))

    def set_rules(self, rules: Any):
        table = np.asarray(rules, dtype=float)
        if table.shape != (5, 5) or not np.all(np.isfinite(table)):
            raise ValueError("tabela de regras precisa ser 5x5 numérica")
        self.rules = np.clip(table, -1.0, 1.0)

    def compute(self, theta: float, theta_dot: float, dt: float,
                x: float = 0.0, x_dot: float = 0.0) -> tuple[int, float]:
        mu_theta = fuzzy_sets_angle(theta + self.kx * x + self.kv * x_dot)
        mu_rate = fuzzy_sets_rate(theta_dot)
        weighted_sum = 0.0
        activation_sum = 0.0
        for i in range(5):
            for j in range(5):
                activation = min(mu_theta[i], mu_rate[j])
                self.activations[i, j] = activation
                weighted_sum += activation * self.rules[i, j]
                activation_sum += activation
        output = weighted_sum / activation_sum if activation_sum > 1e-12 else 0.0
        return (1 if output >= self.threshold else -1), float(output)


class PIDController:
    """PID sobre o ângulo (derivada = theta_dot do estado) + realimentação da posição do carrinho.

    u = Kp·θ + Ki·∫θ + Kd·θ̇ + Kx·x + Kv·ẋ. Kx e Kv mantêm o carrinho perto do centro da pista.
    """

    def __init__(self, kp: float = 80.0, ki: float = 0.0, kd: float = 18.0,
                 kx: float = 6.0, kv: float = 10.0):
        self.kp, self.ki, self.kd = kp, ki, kd
        self.kx, self.kv = kx, kv
        self.integral = 0.0
        self.integral_limit = 2.0

    def reset(self):
        self.integral = 0.0

    def compute(self, theta: float, theta_dot: float, dt: float,
                x: float = 0.0, x_dot: float = 0.0) -> tuple[int, float]:
        self.integral += theta * dt
        self.integral = float(np.clip(self.integral, -self.integral_limit, self.integral_limit))
        output = (self.kp * theta + self.ki * self.integral + self.kd * theta_dot
                  + self.kx * x + self.kv * x_dot)
        return (1 if output >= 0.0 else -1), float(output)


CONTROLLER_TYPES = ("fuzzy", "pid", "manual")


# ---------------------------------------------------------------------------
# Painéis e experimento
# ---------------------------------------------------------------------------

FALL_ANGLE = math.pi / 2  # pêndulo encostou no chão
BENCH_ANGLE = 12 * math.pi / 180  # limite clássico do CartPole-v1


class Panel:
    def __init__(self, key: str, controller: str, config: dict[str, float]):
        self.key = key
        self.env = LabCartPole()
        self.env.apply_physics(config)
        self.controller_type = controller
        self.pid = PIDController()
        self.fuzzy = FuzzyController()
        self.manual_input = 0  # -1, 0, +1
        self.state = np.zeros(4)
        self.reset_metrics()

    @property
    def controller(self):
        return self.pid if self.controller_type == "pid" else self.fuzzy

    def reset_metrics(self):
        self.time = 0.0
        self.time_upright = 0.0
        self.time_in_bench = 0.0
        self.sq_theta = 0.0
        self.max_abs_theta = 0.0
        self.falls = 0
        self.track_hits = 0
        self.max_abs_x = 0.0
        self.fallen = False
        self.fail_reason = None  # "fall" (pêndulo no chão) ou "track" (fim da pista)
        self.action = 0
        self.output = 0.0
        self.control_force = 0.0
        self.disturbance_force = 0.0

    def reset(self, seed: int, keep_metrics: bool = False):
        state, _ = self.env.reset(seed=seed)
        self.state = np.array(state, dtype=float)
        self.env.state = self.state.copy()
        self.pid.reset()
        self.fuzzy.reset()
        self.manual_input = 0
        if keep_metrics:
            self.fallen = False
            self.fail_reason = None
            self.time_upright = 0.0
        else:
            self.reset_metrics()

    def set_controller(self, kind: str):
        if kind in CONTROLLER_TYPES and kind != self.controller_type:
            self.controller_type = kind
            self.pid.reset()
            self.manual_input = 0

    def step(self, disturbance_force: float, dt: float, track_half: float = math.inf):
        if self.fallen:
            self.control_force = 0.0
            self.disturbance_force = 0.0
            return
        theta, theta_dot = float(self.state[2]), float(self.state[3])
        if self.controller_type == "manual":
            direction, output = self.manual_input, float(self.manual_input)
        else:
            direction, output = self.controller.compute(
                theta, theta_dot, dt, float(self.state[0]), float(self.state[1]))
        self.action = int(direction)
        self.output = float(output)
        self.control_force = direction * self.env.force_mag
        self.disturbance_force = disturbance_force
        self.state = self.env.step_force(self.control_force + disturbance_force).copy()

        theta = float(self.state[2])
        self.time += dt
        self.time_upright += dt
        self.sq_theta += theta * theta * dt
        self.max_abs_theta = max(self.max_abs_theta, abs(theta))
        if abs(theta) <= BENCH_ANGLE:
            self.time_in_bench += dt
        x = float(self.state[0])
        self.max_abs_x = max(self.max_abs_x, abs(x))
        if abs(x) >= track_half:
            # Carrinho chegou ao batente do fim da pista: falha, como no CartPole-v1.
            self.fallen = True
            self.fail_reason = "track"
            self.track_hits += 1
            self.state[0] = math.copysign(track_half, x)
            self.state[1] = self.state[3] = 0.0
            self.env.state = self.state.copy()
        elif abs(theta) >= FALL_ANGLE:
            self.fallen = True
            self.fail_reason = "fall"
            self.falls += 1
            self.state[2] = math.copysign(FALL_ANGLE, theta)
            self.state[1] = self.state[3] = 0.0
            self.env.state = self.state.copy()

    def kick_pole(self, delta_omega: float):
        if not self.fallen:
            self.state[3] += delta_omega
            self.env.state = self.state.copy()

    def snapshot(self) -> dict[str, Any]:
        s = self.state
        return {
            "controller": self.controller_type,
            "params": {
                "kp": self.pid.kp, "ki": self.pid.ki, "kd": self.pid.kd,
                "kx": self.pid.kx, "kv": self.pid.kv,
                "threshold": self.fuzzy.threshold,
                "fx": self.fuzzy.kx, "fv": self.fuzzy.kv,
                "rules": self.fuzzy.rules.round(4).tolist(),
            },
            "activations": (self.fuzzy.activations.round(3).tolist()
                            if self.controller_type == "fuzzy" else None),
            "x": float(s[0]), "x_dot": float(s[1]),
            "theta": float(s[2]), "theta_dot": float(s[3]),
            "action": self.action, "control": self.output,
            "control_force": self.control_force,
            "disturbance_force": self.disturbance_force,
            "manual_input": self.manual_input,
            "fallen": self.fallen, "falls": self.falls,
            "fail_reason": self.fail_reason, "track_hits": self.track_hits,
            "max_abs_x": self.max_abs_x,
            "time": self.time, "time_upright": self.time_upright,
            "time_in_bench": self.time_in_bench,
            "rms_theta": math.sqrt(self.sq_theta / self.time) if self.time > 0 else 0.0,
            "max_abs_theta": self.max_abs_theta,
        }


class Experiment:
    DT = 0.02  # CartPole-v1: 50 Hz
    DEFAULT_CONFIG = {
        "cart_mass": 1.0,       # kg
        "pole_mass": 0.1,       # kg
        "pole_length": 1.0,     # m (comprimento total; Gymnasium usa meio comprimento)
        "force_mag": 10.0,      # N (força do atuador)
        "gravity": 9.8,         # m/s²
        "track_length": 4.8,    # m (pista total; CartPole-v1 usa ±2,4 m)
        "cart_width": 0.4,      # m (visualização)
        "cart_height": 0.2,     # m (visualização)
        "pole_thickness": 0.05, # m (visualização)
    }
    LIMITS = {
        "cart_mass": (0.1, 10.0), "pole_mass": (0.01, 2.0),
        "pole_length": (0.2, 3.0), "force_mag": (1.0, 50.0),
        "gravity": (1.0, 25.0), "track_length": (1.0, 20.0), "cart_width": (0.2, 1.0),
        "cart_height": (0.1, 0.5), "pole_thickness": (0.02, 0.15),
    }

    def __init__(self, seed: int = 42):
        self.seed = seed
        self.config = dict(self.DEFAULT_CONFIG)
        self.panels = {"a": Panel("a", "fuzzy", self.config), "b": Panel("b", "pid", self.config)}
        self.running = False
        self.speed = 1
        self.sim_time = 0.0
        self.auto_rise = False
        self.auto_rise_delay = 1.0
        self._fallen_since: dict[str, float] = {}
        # Perturbações: força no carro com duração (lista de pulsos ativos por painel)
        self.pulses: dict[str, list[list[float]]] = {"a": [], "b": []}
        self.auto_disturb = {"enabled": False, "interval": 3.0, "target": "cart",
                             "magnitude": 20.0, "duration": 0.1}
        self._next_auto = 0.0
        self.events: list[dict[str, Any]] = []  # eventos ainda não enviados
        self.samples: list[list[float]] = []    # amostras ainda não enviadas
        self.reset(seed)

    # -- comandos -----------------------------------------------------------
    def reset(self, seed: int | None = None):
        if seed is not None:
            self.seed = int(seed)
        for panel in self.panels.values():
            panel.reset(self.seed)
        self.pulses = {"a": [], "b": []}
        self._fallen_since = {}
        self.sim_time = 0.0
        self._next_auto = self.auto_disturb["interval"]
        self.running = False
        self.events.append({"type": "reset"})

    def rise(self, key: str):
        if key in self.panels:
            self.panels[key].reset(self.seed, keep_metrics=True)
            self.pulses[key] = []
            self._fallen_since.pop(key, None)

    def apply_config(self, values: dict[str, Any]):
        updated = dict(self.config)
        for key, (low, high) in self.LIMITS.items():
            if key in values:
                try:
                    updated[key] = float(np.clip(float(values[key]), low, high))
                except (TypeError, ValueError):
                    pass
        self.config = updated
        # Aplica em tempo real, sem reiniciar o ensaio.
        for panel in self.panels.values():
            panel.env.apply_physics(self.config)

    def set_controller(self, key: str, kind: str, params: dict[str, Any] | None = None):
        panel = self.panels.get(key)
        if panel is None:
            return
        panel.set_controller(kind)
        params = params or {}
        pid, fz = panel.pid, panel.fuzzy
        for name, attr, hi in (("kp", "kp", 500), ("ki", "ki", 100), ("kd", "kd", 200),
                               ("kx", "kx", 100), ("kv", "kv", 100)):
            if name in params:
                setattr(pid, attr, float(np.clip(float(params[name]), 0, hi)))
        for name, attr in (("fx", "kx"), ("fv", "kv")):
            if name in params:
                setattr(fz, attr, float(np.clip(float(params[name]), 0, 1)))
        if "threshold" in params:
            panel.fuzzy.threshold = float(np.clip(float(params["threshold"]), -1, 1))
        if "rules" in params:
            panel.fuzzy.set_rules(params["rules"])

    def set_manual(self, key: str, direction: int):
        panel = self.panels.get(key)
        if panel is not None and panel.controller_type == "manual":
            panel.manual_input = int(np.clip(direction, -1, 1))

    def disturb(self, target: str, direction: int, magnitude: float, duration: float,
                panels: str = "all", source: str = "manual"):
        direction = 1 if direction >= 0 else -1
        keys = list(self.panels) if panels == "all" else [k for k in (panels,) if k in self.panels]
        magnitude = float(np.clip(magnitude, 0, 200))
        if target == "pole":
            # Golpe no pêndulo: variação instantânea da velocidade angular (rad/s).
            delta = direction * float(np.clip(magnitude, 0, 10))
            for k in keys:
                self.panels[k].kick_pole(delta)
            value, unit = delta, "rad/s"
        else:
            steps = max(1, round(float(np.clip(duration, 0.02, 2.0)) / self.DT))
            for k in keys:
                self.pulses[k].append([direction * magnitude, steps])
            value, unit = direction * magnitude, "N"
        self.events.append({"type": "disturb", "t": self.sim_time, "target": target,
                            "value": value, "unit": unit, "panels": keys, "source": source})

    # -- simulação ----------------------------------------------------------
    def _disturbance_force(self, key: str) -> float:
        total = 0.0
        alive = []
        for pulse in self.pulses[key]:
            total += pulse[0]
            pulse[1] -= 1
            if pulse[1] > 0:
                alive.append(pulse)
        self.pulses[key] = alive
        return total

    def advance(self):
        ad = self.auto_disturb
        if ad["enabled"] and self.sim_time >= self._next_auto:
            self.disturb(ad["target"], random.choice((-1, 1)), ad["magnitude"],
                         ad["duration"], "all", source="auto")
            self._next_auto = self.sim_time + ad["interval"]

        track_half = max(0.05, self.config["track_length"] / 2 - self.config["cart_width"] / 2)
        for key, panel in self.panels.items():
            panel.step(self._disturbance_force(key), self.DT, track_half)
            if panel.fallen and self.auto_rise:
                since = self._fallen_since.setdefault(key, self.sim_time)
                if self.sim_time - since >= self.auto_rise_delay:
                    self.rise(key)
        self.sim_time += self.DT
        self.samples.append([round(self.sim_time, 4),
                             float(self.panels["a"].state[2]),
                             float(self.panels["b"].state[2])])

    def snapshot(self) -> dict[str, Any]:
        data = {
            "type": "state",
            "version": VERSION,
            "running": self.running,
            "speed": self.speed,
            "seed": self.seed,
            "sim_time": self.sim_time,
            "config": dict(self.config),
            "auto_disturb": dict(self.auto_disturb),
            "auto_rise": self.auto_rise,
            "defaults": {"kp": 80.0, "ki": 0.0, "kd": 18.0, "kx": 6.0, "kv": 10.0,
                         "threshold": 0.0, "fx": 0.08, "fv": 0.02,
                         "rules": FuzzyController.RULES.tolist()},
            "panels": {k: p.snapshot() for k, p in self.panels.items()},
            "samples": self.samples,
            "events": self.events,
        }
        self.samples = []
        self.events = []
        return data

    def handle(self, message: dict[str, Any]):
        command = message.get("command")
        if command == "start":
            self.running = True
        elif command == "pause":
            self.running = False
        elif command == "reset":
            self.reset(int(message.get("seed", self.seed)))
        elif command == "rise":
            self.rise(str(message.get("panel")))
        elif command == "speed":
            self.speed = int(np.clip(int(message.get("value", 1)), 1, 10))
        elif command == "controller":
            self.set_controller(str(message.get("panel")), str(message.get("type")),
                                message.get("params"))
        elif command == "manual":
            self.set_manual(str(message.get("panel")), int(message.get("direction", 0)))
        elif command == "physical_config":
            self.apply_config(message.get("values", {}))
        elif command == "disturb":
            self.disturb(str(message.get("target", "cart")), int(message.get("direction", 1)),
                         float(message.get("magnitude", 20)), float(message.get("duration", 0.1)),
                         str(message.get("panels", "all")))
        elif command == "auto_disturb":
            ad = self.auto_disturb
            ad["enabled"] = bool(message.get("enabled", ad["enabled"]))
            ad["interval"] = float(np.clip(float(message.get("interval", ad["interval"])), 0.5, 60))
            ad["target"] = "pole" if message.get("target", ad["target"]) == "pole" else "cart"
            ad["magnitude"] = float(np.clip(float(message.get("magnitude", ad["magnitude"])), 0, 200))
            ad["duration"] = float(np.clip(float(message.get("duration", ad["duration"])), 0.02, 2.0))
            self._next_auto = self.sim_time + ad["interval"]
        elif command == "auto_rise":
            self.auto_rise = bool(message.get("enabled", False))

    def close(self):
        for panel in self.panels.values():
            panel.env.close()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    experiment = Experiment()
    loop = asyncio.get_running_loop()

    async def receiver():
        while True:
            message = await websocket.receive_json()
            if isinstance(message, dict):
                try:
                    experiment.handle(message)
                except (TypeError, ValueError):
                    pass  # mensagem malformada: ignora

    async def simulator():
        next_tick = loop.time()
        while True:
            if experiment.running:
                for _ in range(experiment.speed):
                    experiment.advance()
            await websocket.send_json(experiment.snapshot())
            next_tick += Experiment.DT
            delay = next_tick - loop.time()
            if delay > 0:
                await asyncio.sleep(delay)
            else:
                next_tick = loop.time()  # atrasou: ressincroniza sem tentar compensar

    tasks = [asyncio.create_task(receiver()), asyncio.create_task(simulator())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError, Exception):
                await task
        experiment.close()
