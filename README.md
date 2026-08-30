# Goldcoin Solana Reserve Bridge UI

Official web interface for the **Goldcoin ↔ Solana Reserve Bridge**.

This application provides the user-facing interface for transferring GLC between the native Goldcoin blockchain and the existing GLC asset on Solana through a **reserve-backed 1:1 bridge architecture**.

> **Important:** This bridge does not mint, burn, wrap, or create GLC. Transfers are fulfilled using existing GLC held in reserves on each network.

## Architecture

The bridge connects:

**Goldcoin L1 native GLC**

↕️

**Goldcoin Solana Reserve Bridge**

↕️

**Existing Solana GLC**

Canonical Solana GLC mint:

`Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump`

The Solana asset uses **Token-2022** and 6 decimal places.

Native Goldcoin uses 8 decimal places.

The bridge backend handles denomination conversion safely and treats the backend as authoritative for settlement amounts.

## How Transfers Work

### Goldcoin → Solana

1. The user requests a bridge quote.
2. The bridge verifies available Solana reserve liquidity.
3. The user deposits native GLC to the provided Goldcoin reserve destination.
4. The backend observes and confirms the Goldcoin transaction.
5. Settlement is authorized.
6. Existing GLC is released from the Solana reserve.
7. The transfer reaches its final settled state.

### Solana → Goldcoin

1. The user requests a bridge quote.
2. The bridge verifies available Goldcoin reserve liquidity.
3. The user deposits existing Solana GLC into the Solana reserve.
4. The backend observes and confirms the Solana transaction.
5. Settlement is authorized.
6. Existing native GLC is released from the Goldcoin reserve.
7. The transfer reaches its final settled state.

## Bridge Fee

The bridge charges a **3% service fee**. Network fees are separate.

For example:

```text
Bridge amount:  1,000 GLC
Bridge fee:        30 GLC
You receive:      970 GLC
```

Quotes, fees, limits, reserve capacity, and final settlement amounts are determined by the bridge backend.

The frontend must not independently override backend-authoritative settlement calculations.

## Reserve-Backed Design

The system is designed around pre-funded reserves.

It does **not**:

- mint GLC
- burn GLC
- create wrapped GLC
- create replacement tokens
- alter token supply

A transfer is possible only when sufficient destination-side reserve liquidity is available.

The UI therefore exposes bridge availability and reserve capacity rather than implying unlimited conversion capacity.

## UI Features

The interface is intended to provide:

- Goldcoin → Solana transfers
- Solana → Goldcoin transfers
- wallet and address handling
- backend-authoritative bridge quotes
- gross amount, fee, and net amount display
- reserve liquidity information
- transfer limits
- bridge and direction status
- transfer progress tracking
- transfer history
- bridge explorer
- reserve history
- bridge statistics
- responsive desktop and mobile interfaces
- explicit paused and insufficient-liquidity states
- recovery of existing transfers after page refresh

## Transfer Lifecycle

The UI maps the bridge backend state machine into a user-friendly transfer progress display.

A typical successful transfer progresses through states such as:

```text
Request Created
       ↓
Awaiting Source Deposit
       ↓
Deposit Observed
       ↓
Confirming
       ↓
Source Finalized
       ↓
Settlement Authorized
       ↓
Destination Submitted
       ↓
Destination Confirmed
       ↓
Settled
```

The backend remains authoritative for the actual lifecycle state.

## API Integration

This frontend is designed for the new Goldcoin Solana Reserve Bridge backend.

Relevant backend functionality includes:

```text
Bridge status
Direction availability
Reserve capacity
Quotes
Transfer creation
Transfer status
Transfer listing
Statistics
Reserve history
Explorer events
```

Read-oriented endpoints include:

```text
GET /stats
GET /reserves/history
GET /explorer/events
GET /transfers
```

The frontend should use the backend's actual API schemas rather than maintaining assumptions inherited from the previous bridge implementation.

## Security Principles

The frontend must never:

- request or store private keys
- perform custody operations
- authorize reserve releases itself
- calculate authoritative settlement values independently
- bypass backend reserve checks
- bypass backend fee calculations
- represent an unknown transaction as successful
- expose internal signer or custody information

All security-sensitive bridge decisions remain backend/on-chain responsibilities.

## Relationship to the Previous Bridge UI

This project succeeds the previous Goldcoin Solana bridge frontend.

Useful visual components, responsive layouts, accessibility patterns, wallet UX, and general Goldcoin branding may be adapted from the previous interface.

However, the previous wrapped-token/federation architecture must **not** be carried into this application.

The new interface is built specifically around the reserve-backed bridge model.

## Repositories

### Frontend

`Reaper-lk/glc-solana-reserve-bridge-ui`

### Bridge Backend

`Reaper-lk/glc-solana-reserve-bridge`

The backend and frontend are maintained as separate projects.

## Development Status

🚧 **Under active development**

The interface is currently being adapted for the new reserve-backed bridge backend.

Do not use development builds for production transfers unless the release has been explicitly approved for production use.

## Development

Clone the repository:

```bash
git clone https://github.com/Reaper-lk/glc-solana-reserve-bridge-ui.git
cd glc-solana-reserve-bridge-ui
```

Install dependencies and follow the project-specific development commands defined by the frontend implementation.

## License

Licensing follows the applicable Goldcoin project licensing terms.

---

**Goldcoin Solana Reserve Bridge**

Native GLC. Existing reserves. Two networks. One bridge.
