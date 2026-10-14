"""Blockchain ledger adapter layer (Layer 5).

Two implementations behind one interface:
  - BesuLedgerAdapter: the real integration target (Hyperledger Besu, EVM). It is
    ACTIVE only when BESU_RPC_URL, BESU_CHAIN_ID, LEDGER_CONTRACT_ADDRESS and
    LEDGER_SIGNER_KEY are all configured. Without a provisioned node it reports
    itself unavailable — it never fabricates a transaction.
  - DevSimulationLedger: a clearly-labeled local development ledger that mimics
    the anchoring flow (tx hash, block height, confirmations). Every result it
    returns carries simulated=True so no UI can mistake it for a real chain.

Only decision IDs and record hashes are ever anchored — never business records.
"""

import hashlib
import logging
import os
from datetime import datetime, timezone

from lib.db import db

logger = logging.getLogger("zayotm.ledger")

# Reference Solidity contract (kept as source; deployed only when a Besu node is configured).
REGISTRY_CONTRACT_SOURCE = """// SPDX-License-Identifier: MIT
// ZaYoTm DecisionRegistry — minimal anchoring contract for a permissioned Besu network.
// Stores ONLY (decisionId => recordHash). No business records, PII, or documents on-chain.
pragma solidity ^0.8.24;

contract ZayotmDecisionRegistry {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    mapping(bytes32 => bytes32) public decisionHashes;   // decisionId -> recordHash
    address public registrar;

    event DecisionAnchored(bytes32 indexed decisionId, bytes32 recordHash, uint256 anchoredAt);
    event DecisionRevoked(bytes32 indexed decisionId, bytes32 recordHash, uint256 revokedAt);

    modifier onlyRegistrar() { require(msg.sender == registrar, "not registrar"); _; }

    constructor() { registrar = msg.sender; }

    function anchor(bytes32 decisionId, bytes32 recordHash) external onlyRegistrar {
        require(decisionHashes[decisionId] == 0, "already anchored");
        decisionHashes[decisionId] = recordHash;
        emit DecisionAnchored(decisionId, recordHash, block.timestamp);
    }

    function revoke(bytes32 decisionId, bytes32 recordHash) external onlyRegistrar {
        require(decisionHashes[decisionId] == recordHash, "hash mismatch");
        delete decisionHashes[decisionId];
        emit DecisionRevoked(decisionId, recordHash, block.timestamp);
    }

    function verify(bytes32 decisionId, bytes32 expectedHash) external view returns (bool) {
        return decisionHashes[decisionId] == expectedHash;
    }
}
"""


class LedgerNotConfigured(Exception):
    pass


class DevSimulationLedger:
    """Local development ledger. Always labeled simulated=True."""

    name = "dev-simulation"
    network = "zayotm-dev-ledger (local EVM-shaped simulation)"
    simulated = True

    async def anchor(self, decision_id: str, record_hash: str) -> dict:
        state = await db.ledger_state.find_one({"key": "dev"})
        block_number = (state["height"] + 1) if state else 1
        await db.ledger_state.update_one({"key": "dev"}, {"$set": {"height": block_number}}, upsert=True)
        nonce = hashlib.sha256(f"{decision_id}:{block_number}:{datetime.now(timezone.utc).isoformat()}".encode()).hexdigest()[:8]
        tx_hash = "0x" + hashlib.sha256(f"{decision_id}:{record_hash}:{nonce}".encode()).hexdigest()
        tx = {
            "tx_hash": tx_hash,
            "block_number": block_number,
            "network": self.network,
            "simulated": True,
            "decision_id": decision_id,
            "record_hash": record_hash,
            "contract_address": "0xZAyonotice-DEV-REGISTRY-000000000000000",
            "gas_used": "simulated",
            "confirmations": 1,
            "anchored_at": datetime.now(timezone.utc),
            "event": "DecisionAnchored(bytes32 indexed decisionId, bytes32 recordHash, uint256 anchoredAt)",
        }
        await db.ledger_txs.insert_one(dict(tx))  # copy: keep _id out of the embedded record doc
        return tx

    async def verify(self, decision_id: str, record_hash: str) -> dict:
        tx = await db.ledger_txs.find_one({"decision_id": decision_id, "record_hash": record_hash})
        return {
            "on_ledger": tx is not None,
            "simulated": True,
            "network": self.network,
            "tx_hash": tx["tx_hash"] if tx else None,
            "block_number": tx["block_number"] if tx else None,
        }


class BesuLedgerAdapter:
    """Real Hyperledger Besu (EVM) adapter. Requires a provisioned permissioned node."""

    name = "besu"
    simulated = False

    def __init__(self):
        self.rpc_url = os.environ.get("BESU_RPC_URL", "")
        self.chain_id = os.environ.get("BESU_CHAIN_ID", "")
        self.contract_address = os.environ.get("LEDGER_CONTRACT_ADDRESS", "")
        self.signer_key = os.environ.get("LEDGER_SIGNER_KEY", "")

    def configured(self) -> bool:
        return bool(self.rpc_url and self.chain_id and self.contract_address and self.signer_key)

    async def anchor(self, decision_id: str, record_hash: str) -> dict:
        if not self.configured():
            raise LedgerNotConfigured(
                "Besu adapter is not configured (BESU_RPC_URL / BESU_CHAIN_ID / "
                "LEDGER_CONTRACT_ADDRESS / LEDGER_SIGNER_KEY). No transaction was sent — "
                "the platform will not fabricate a chain transaction."
            )
        raise LedgerNotConfigured(
            "Besu adapter is configured but the web3 transaction runtime is not bundled in this "
            "prototype environment. Provision the node + contract, install web3, and this adapter "
            "returns a real tx receipt. No simulated transaction was substituted."
        )

    async def verify(self, decision_id: str, record_hash: str) -> dict:
        if not self.configured():
            raise LedgerNotConfigured("Besu adapter not configured.")
        raise LedgerNotConfigured("web3 runtime not bundled in this prototype environment.")


def besu_status() -> dict:
    adapter = BesuLedgerAdapter()
    return {
        "adapter": "besu",
        "configured": adapter.configured(),
        "rpc_url": adapter.rpc_url or None,
        "chain_id": adapter.chain_id or None,
        "contract_address": adapter.contract_address or None,
        "note": "Configure the four BESU/LEDGER env vars to activate the real permissioned-ledger path.",
    }


def get_adapter() -> tuple[object, str]:
    """Returns (adapter, mode_description). Dev simulation unless Besu is fully configured."""
    adapter = BesuLedgerAdapter()
    if adapter.configured():
        return adapter, "besu (permissioned EVM)"
    return DevSimulationLedger(), "dev-simulation (clearly labeled, not a real chain)"
