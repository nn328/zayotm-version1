"""Quantum Optimization Module (Layer 4).

Genuine QAOA (Quantum Approximate Optimization Algorithm) on the procurement
selection QUBO, executed on a *simulator* — never on fabricated numbers:

  Formulation:  E(x) = xᵀQx  with  Q = -diag(value) + λ · off-diag(costᵢ·costⱼ)
  minimizing E = -Σ value·xᵢ + λ(Σ cost·xᵢ - B)²  ⟺  maximize value under budget.

  Execution: p-layer QAOA ansatz |γ,β⟩ = Π e^{-iβₗΣX} e^{-iγₗE} |+⟩ⁿ.
  Parameter search minimizes ⟨E⟩ evaluated by exact statevector simulation;
  final bitstrings are drawn by shot sampling — via Qiskit Aer when the package
  is importable, otherwise via the equivalent statevector probability sampling.
  The engine label returned on every run states exactly which path executed.

  QAOA is a heuristic: if it returns a worse objective than the classical exact
  baseline, the measured numbers are shown as measured (no quantum-advantage claim).
"""

import logging
import math
import time

import numpy as np

logger = logging.getLogger("zayotm.quantum")

try:
    from scipy.optimize import minimize

    _SCIPY = True
except Exception:  # noqa: BLE001
    _SCIPY = False

try:
    import qiskit  # noqa: F401
    from qiskit import QuantumCircuit, transpile
    from qiskit.circuit.library import DiagonalGate

    _QISKIT = True
except Exception:  # noqa: BLE001
    try:
        from qiskit import QuantumCircuit, transpile
        from qiskit.circuit.library import DiagonalGate

        _QISKIT = True
    except Exception:  # noqa: BLE001
        _QISKIT = False

try:
    from qiskit_aer import AerSimulator

    _AER = True
except Exception:  # noqa: BLE001
    _AER = False

QISKIT_VERSION = None
if _QISKIT:
    try:
        from qiskit import __version__ as _qv

        QISKIT_VERSION = _qv
    except Exception:  # noqa: BLE001
        pass


def engine_label() -> dict:
    if _QISKIT and _AER:
        return {"engine": "qiskit-aer-simulator", "library": f"Qiskit {QISKIT_VERSION} + Aer", "simulated": True}
    if _QISKIT:
        return {"engine": "qiskit-statevector-simulator", "library": f"Qiskit {QISKIT_VERSION}", "simulated": True}
    return {"engine": "custom-statevector (numpy)", "library": "numpy statevector", "simulated": True}


def build_qubo(candidates: list[dict], budget: float, penalty: float | None = None) -> tuple[np.ndarray, dict]:
    """QUBO: E(x) = xᵀQx. Symmetric Q; offset captures the constant B² term."""
    n = len(candidates)
    values = np.array([c["value"] for c in candidates], dtype=float)
    costs = np.array([c["cost"] for c in candidates], dtype=float)
    lam = penalty if penalty is not None else max(2.0 * values.sum(), 1.0) / max(budget, 1.0)

    Q = np.zeros((n, n))
    for i in range(n):
        Q[i, i] = -values[i] + lam * (costs[i] ** 2 - 2 * budget * costs[i])
        for j in range(n):
            if i != j:
                Q[i, j] += lam * costs[i] * costs[j]
    offset = lam * budget * budget
    meta = {
        "variables": [c["id"] for c in candidates],
        "n_vars": n,
        "penalty_lambda": round(float(lam), 6),
        "objective": "maximize Σ valueᵢxᵢ subject to Σ costᵢxᵢ ≤ B (encoded as quadratic penalty)",
        "budget": budget,
    }
    return Q, meta


def _basis_energies(Q: np.ndarray) -> np.ndarray:
    n = Q.shape[0]
    dim = 1 << n
    energies = np.empty(dim)
    for basis in range(dim):
        bits = [(basis >> k) & 1 for k in range(n)]
        energies[basis] = sum(Q[i][j] * bits[i] * bits[j] for i in range(n) for j in range(n))
    return energies


def _qaoa_state(params: np.ndarray, energies: np.ndarray, p: int) -> np.ndarray:
    n_bits = int(math.log2(len(energies)))
    state = np.ones(2**n_bits, dtype=complex) / math.sqrt(2**n_bits)
    for layer in range(p):
        state *= np.exp(-1j * params[layer] * energies)          # phase separator e^{-iγE}
        for q in range(n_bits):                                   # mixer e^{-iβΣX} = Π RX(2β)
            state = _apply_rx(state, q, 2 * params[p + layer], n_bits)
    return state


def _apply_rx(state: np.ndarray, qubit: int, theta: float, n_bits: int) -> np.ndarray:
    out = np.empty_like(state)
    mask = 1 << qubit
    cos, sin = math.cos(theta / 2), math.sin(theta / 2)
    for i in range(len(state)):
        if i & mask:
            continue
        j = i | mask
        a, b = state[i], state[j]
        out[i] = cos * a - 1j * sin * b
        out[j] = cos * b - 1j * sin * a
    return out


def run_quantum(candidates: list[dict], budget: float, p: int = 1, shots: int = 1024, seed: int = 42) -> dict:
    """Executes the QAOA experiment and returns measured results + honest engine labels."""
    started = time.perf_counter()
    label = engine_label()
    Q, meta = build_qubo(candidates, budget)
    energies = _basis_energies(Q)
    dim = len(energies)

    rng = np.random.default_rng(seed)
    x0 = [rng.uniform(0, math.pi), rng.uniform(-1, 1)] * p
    history: list[dict] = []

    if _SCIPY:
        def objective(params: np.ndarray) -> float:
            state = _qaoa_state(np.asarray(params), energies, p)
            expectation = float((np.abs(state) ** 2 * energies).sum())
            history.append({"step": len(history), "expectation": round(expectation, 4)})
            return expectation

        opt = minimize(objective, np.array(x0), method="COBYLA", options={"maxiter": 120, "rhobeg": 0.8})
        params = np.asarray(opt.x)
    else:  # no scipy — deterministic small grid search (still a real optimization pass)
        best, params = float("inf"), np.array(x0)
        for gamma in np.linspace(0.1, 1.2, 8):
            for beta in np.linspace(0.1, 0.8, 6):
                state = _qaoa_state(np.array([gamma, beta] * p), energies, p)
                exp = float((np.abs(state) ** 2 * energies).sum())
                history.append({"step": len(history), "expectation": round(exp, 4)})
                if exp < best:
                    best, params = exp, np.array([gamma, beta] * p)

    final_state = _qaoa_state(params, energies, p)
    probs = np.abs(final_state) ** 2

    # shot sampling — Aer executes the actual QAOA circuit when available
    counts: dict[str, int] = {}
    if _QISKIT and _AER:
        try:
            counts = _aer_sample(Q, params, p, shots, seed)
            if not counts:
                raise RuntimeError("Aer returned no counts")
            sampling_backend = "qiskit-aer (statevector simulator, shots=%d)" % shots
        except Exception as exc:  # noqa: BLE001 — documented fallback, never hidden
            logger.warning("Aer sampling failed (%s) — falling back to statevector sampling", exc)
            counts = _statevector_sample(probs, shots, seed)
            sampling_backend = "statevector sampling (Aer failed: see logs)"
    else:
        counts = _statevector_sample(probs, shots, seed)
        sampling_backend = "statevector sampling (numpy)"

    # measured best bitstring: lowest sampled energy
    n = Q.shape[0]
    best_bits, best_energy = None, float("inf")
    for bits, count in counts.items():
        basis = int(bits.replace(" ", "")[:n][::-1], 2)  # qiskit little-endian → candidate index
        energy = float(energies[basis])
        if energy < best_energy:
            best_bits, best_energy = bits.replace(" ", "")[:n][::-1], energy

    runtime_ms = (time.perf_counter() - started) * 1000

    if best_bits is None:
        return {**meta, "engine": label["engine"], "library": label["library"], "sampling_backend": sampling_backend,
                "executed": True, "method": "QAOA", "depth_p": p, "shots": shots,
                "objective": 0.0, "feasible": False, "solution": [], "runtime_ms": round(runtime_ms, 2),
                "convergence": history, "notes": ["QAOA sampled no bitstrings — see solver logs."]}

    solution_ids = [candidates[i]["id"] for i, bit in enumerate(best_bits) if bit == "1"]
    total_cost = sum(c["cost"] for c in candidates if c["id"] in solution_ids)
    objective = sum(c["value"] for c in candidates if c["id"] in solution_ids)
    feasible = total_cost <= budget

    return {
        **meta,
        "engine": label["engine"],
        "library": label["library"],
        "sampling_backend": sampling_backend,
        "executed": True,
        "method": "QAOA",
        "depth_p": p,
        "shots": shots,
        "params": {"gamma": [round(float(g), 4) for g in params[:p]], "beta": [round(float(b), 4) for b in params[p:]]},
        "objective": round(objective, 4),
        "objective_is_energy": False,
        "min_sampled_energy": round(best_energy, 4),
        "feasible": feasible,
        "total_cost": round(total_cost, 2),
        "solution": solution_ids,
        "runtime_ms": round(runtime_ms, 2),
        "convergence": history,
        "top_states": sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:5],
        "notes": [
            "QAOA is a heuristic — this result is compared against the exact classical baseline as measured.",
            "Executed on a simulator, not quantum hardware.",
        ],
    }


def _statevector_sample(probs: np.ndarray, shots: int, seed: int) -> dict[str, int]:
    rng = np.random.default_rng(seed)
    draws = rng.choice(len(probs), size=shots, p=probs / probs.sum())
    n_bits = int(math.log2(len(probs)))
    counts: dict[str, int] = {}
    for d in draws:
        bits = format(int(d), f"0{n_bits}b")[::-1]
        counts[bits] = counts.get(bits, 0) + 1
    return counts


def _aer_sample(Q: np.ndarray, params: np.ndarray, p: int, shots: int, seed: int) -> dict[str, int]:
    """Builds the QAOA circuit (diagonal cost phase + RX mixer) and executes it on AerSimulator."""
    from qiskit import QuantumCircuit, transpile
    from qiskit_aer import AerSimulator

    n = Q.shape[0]
    energies = _basis_energies(Q)
    qc = QuantumCircuit(n)
    qc.h(range(n))
    for layer in range(p):
        diag = [complex(np.exp(-1j * float(params[layer]) * float(e))) for e in energies]
        qc.append(DiagonalGate(diag), range(n))
        for q in range(n):
            qc.rx(2 * float(params[p + layer]), q)
    qc.measure_all()

    sim = AerSimulator()
    compiled = transpile(qc, sim)
    result = sim.run(compiled, shots=shots, seed_simulator=seed).result()
    return result.get_counts()
