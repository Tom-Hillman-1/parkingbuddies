$ErrorActionPreference = "Stop"

$containerName = "parkingbuddies-postgres"
$dbUser = "postgres"
$dbName = "parkingbuddies"
$snapshotPath = Join-Path $PSScriptRoot "manual_demo_snapshot.sql"

if (-not (Test-Path -LiteralPath $snapshotPath)) {
    throw "Manual demo snapshot not found at $snapshotPath"
}

$runningContainer = docker ps --filter "name=^/${containerName}$" --format "{{.Names}}"
if (-not ($runningContainer -split "`r?`n" | Where-Object { $_ -eq $containerName })) {
    throw "Docker container '$containerName' is not running. Start it first with 'docker compose up -d db'."
}

docker exec $containerName pg_isready -U $dbUser -d $dbName | Out-Null

$resetSql = @"
TRUNCATE TABLE
    public.payments,
    public.reward_transactions,
    public.bookings,
    public.auction_bids,
    public.parking_spots,
    public.users
RESTART IDENTITY CASCADE;
"@

$resetSql | docker exec -i $containerName psql -v ON_ERROR_STOP=1 -U $dbUser -d $dbName | Out-Null
Get-Content -Raw -LiteralPath $snapshotPath | docker exec -i $containerName psql -v ON_ERROR_STOP=1 -U $dbUser -d $dbName | Out-Null

Write-Host "Manual demo snapshot restored successfully from $snapshotPath"
