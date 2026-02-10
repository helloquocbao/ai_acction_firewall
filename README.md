# AI Action Firewall (Sui MVP)

This is a minimal Sui Move implementation of an on-chain action firewall for AI agents. It focuses on transfer-only permissions for hackathon scope.

## Objects
- `AdminCap`: capability to issue and revoke permissions.
- `Vault`: shared vault that holds SUI balance.
- `Permission`: scoped capability for an agent (max per transfer, total quota, expiry, revoke).
- `ActionProposal`: intent record for a transfer.

## Flow
1. Create `AdminCap` and `Vault`.
2. Fund the `Vault` with SUI.
3. Issue `Permission` to an agent address.
4. Agent creates an `ActionProposal`.
5. Agent executes the transfer through the firewall.

## Notes
- Only transfer actions are supported in this MVP.
- Expiry uses on-chain `Clock` time in milliseconds.
- Set `expires_at_ms` to `0` for no expiry.
- Set `max_total` to `0` for unlimited total quota.

## Next Extensions
- Allowlist for contract calls.
- Risk scoring or human-in-the-loop approvals.
- Multi-action permissions and rate limits.

## Deployed (testnet)
- Network: testnet
- Package: `0x80b36d20a10a40d6b0e7f22ecdd5bb2cd2e496fe7c8d1c7cf660b37fafa606df`
- UpgradeCap: `0x42d504be2a8474a8ff7ea14684061d54f1fca4de8ee7b9308d3682a7bcbfe6d3`

## Demo (PowerShell)
Run the end-to-end demo script (amounts are in MIST):

```powershell
.\scripts\demo.ps1
```

Optional params:
```powershell
.\scripts\demo.ps1 -Recipient 0xYOUR_ADDR -DepositAmount 100000000 -MaxAmount 50000000 -TransferAmount 10000000
```

Notes:
- `Clock` object ID is `0x6` (used internally by the script).
- Script creates new `AdminCap`, `Vault`, `Permission`, and `ActionProposal` each run.

## UI (Vite + React)
1. `cd ui`
2. `yarn install`
3. `yarn dev`

Update constants in `ui/src/ids.ts` if you publish a new package or switch networks.
