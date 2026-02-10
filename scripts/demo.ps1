param(
  [string]$Recipient = "",
  [long]$DepositAmount = 100000000,
  [long]$MaxAmount = 50000000,
  [long]$TotalQuota = 100000000,
  [long]$TransferAmount = 10000000,
  [long]$GasBudget = 10000000
)

$packageId = "0x80b36d20a10a40d6b0e7f22ecdd5bb2cd2e496fe7c8d1c7cf660b37fafa606df"
$module = "firewall"
$clockId = "0x6"

$agent = (sui client active-address).Trim()
if (-not $Recipient) { $Recipient = $agent }

function Get-CreatedObjectIdBySuffix($changes, $suffix) {
  $obj = $changes | Where-Object { $_.type -eq "created" -and $_.objectType -like "*$suffix" } | Select-Object -First 1
  if (-not $obj) { throw "Could not find created object for $suffix" }
  return $obj.objectId
}

Write-Host "Active address: $agent"
Write-Host "Recipient: $Recipient"

$adminRes = sui client call --package $packageId --module $module --function create_admin --gas-budget $GasBudget --json | ConvertFrom-Json
$adminId = Get-CreatedObjectIdBySuffix $adminRes.objectChanges "::firewall::AdminCap"
Write-Host "AdminCap: $adminId"

$vaultRes = sui client call --package $packageId --module $module --function create_vault --args $adminId --gas-budget $GasBudget --json | ConvertFrom-Json
$vaultId = Get-CreatedObjectIdBySuffix $vaultRes.objectChanges "::firewall::Vault"
Write-Host "Vault: $vaultId"

$gasInfo = (sui client gas --json | ConvertFrom-Json)[0]
$gasCoinId = $gasInfo.gasCoinId
Write-Host "Gas coin: $gasCoinId"

$payRes = sui client pay-sui --input-coins $gasCoinId --recipients $agent --amounts $DepositAmount --gas-budget $GasBudget --json | ConvertFrom-Json
$depositCoinId = ($payRes.objectChanges | Where-Object { $_.type -eq "created" -and $_.objectType -eq "0x2::coin::Coin<0x2::sui::SUI>" } | Select-Object -First 1).objectId
if (-not $depositCoinId) { throw "Could not find new SUI coin from pay-sui" }
Write-Host "Deposit coin: $depositCoinId"

sui client call --package $packageId --module $module --function deposit --args $vaultId $depositCoinId --gas-budget $GasBudget | Out-Null
Write-Host "Deposited $DepositAmount MIST into vault"

$permRes = sui client call --package $packageId --module $module --function issue_permission --args $adminId $vaultId $agent $MaxAmount $TotalQuota 0 --gas-budget $GasBudget --json | ConvertFrom-Json
$permissionId = Get-CreatedObjectIdBySuffix $permRes.objectChanges "::firewall::Permission"
Write-Host "Permission: $permissionId"

$proposalRes = sui client call --package $packageId --module $module --function propose_transfer --args $permissionId $Recipient $TransferAmount $clockId --gas-budget $GasBudget --json | ConvertFrom-Json
$proposalId = Get-CreatedObjectIdBySuffix $proposalRes.objectChanges "::firewall::ActionProposal"
Write-Host "Proposal: $proposalId"

sui client call --package $packageId --module $module --function execute_transfer --args $vaultId $permissionId $proposalId $clockId --gas-budget $GasBudget | Out-Null
Write-Host "Transfer executed."
